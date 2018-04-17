// jshint strict:false,-W079
process.title = 'MLPVC-WS';

const
	PORT = 8667,
	fs = require('fs'),
	pg = require('pg'),
	_ = require('underscore'),
	config = require('./config'),
	moment = require('moment-timezone'),
	SocketIO = require('socket.io'),
	express = require('express'),
	https = require('https'),
	cors = require('cors'),
	createHash = require('sha.js'),
	sha256hash = data => createHash('sha256').update(data, 'utf8').digest('hex'),
	POST_UPDATES_CHANNEL = 'post-updates',
	ENTRY_UPDATES_CHANNEL = 'entry-updates';

let Database = new pg.Client(`postgres://${config.DB_USER}:${config.DB_PASS}@${config.DB_HOST}/mlpvc-rr`),
	app = express();

// CORS
app.use(cors({ origin: config.ORIGIN_REGEX }));

app.get('/', function (req, res) {
	res.sendStatus(403);
});

let server;
if (config.LOCALHOST === true){
	server = https.createServer({
		cert: fs.readFileSync(config.SSL_CERT),
		key: fs.readFileSync(config.SSL_KEY),
	}, app);
}
else {
	let lex = require('greenlock-express').create({
		server: config.LE_SERVER,
		email: config.LE_EMAIL,
		agreeTos: true,
		approveDomains: config.LE_DOMAINS,
		renewWithin: 1728000000,
	});
	server = https.createServer(lex.httpsOptions, lex.middleware(app));
}
server.listen(PORT);
let io = SocketIO.listen(server);
io.origins(function(origin, callback){
	if (!config.ORIGIN_REGEX.test(origin))
		return callback('origin not allowed', false);
	callback(null, true);
});
log(`[Socket.io] Server listening on port ${PORT}`);

moment.locale('en');
moment.tz.add('Europe/Budapest|CET CEST|-10 -20|01010101010101010101010|1BWp0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00 11A0 1o00 11A0 1o00 11A0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00 11A0 1o00|11e6');
moment.tz.setDefault('Europe/Budapest');
function log(text){
	console.log(moment().format('YYYY-MM-DD HH:mm:ss.SSS')+' | ' + text);
}
function _respond(message, status, extra){
	let response;
	if (message === true)
		response = {status:true};
	else if (_.isObject(message) && !status && !extra){
		message.status = true;
		response = message;
	}
	else response = {
		"message": message || 'Insufficient permissions',
		"status": Boolean(status),
	};
	if (extra)
		_.extend(response, extra);
	return response;
}
function respond(fn){
	if (typeof fn !== 'function')
		return;
	fn(JSON.stringify(_respond.apply(undefined, [].slice.call(arguments,1))));
}
function queryhandle(f){
	return function(err, result){
		if(err) {
	      return console.error('error running query', err);
	    }
	    f(result.rows, result);
	};
}
function pleaseNotify(socket, userid){
	Database.query('SELECT COUNT(*) as cnt FROM notifications WHERE recipient_id = $1 AND read_at IS NULL', [userid], queryhandle(function(result){
		if (typeof result[0] !== 'object')
			return;

		socket.emit('notif-cnt', _respond({ cnt: parseInt(result[0].cnt,10) }));
	}));
}
function json_decode(data){
	return typeof data === 'string' ? JSON.parse(data) : data;
}
function findAuthCookie(socket){
	if (!socket.handshake.headers.cookie || !socket.handshake.headers.cookie.length)
		return;
	let cookieArray = socket.handshake.headers.cookie.split('; '),
		cookies = {};
	for (let i=0; i<cookieArray.length; i++){
		let split = cookieArray[i].split('=');
		cookies[split[0]] = split[1];
	}
	return cookies.access;
}
const getGuestID = (socket) => 'Guest#'+socket.id;

Database.connect(function(err) {
	if (err !== null){
		log('[Database] Connection failed, exiting ('+err+')');
		return process.exit();
	}

	log('[Database] Connection successful');
});
Database.on('error',function(err){
	console.log(err);
	if (err.fatal)
		process.exit();
});

const
	SocketMeta = {},
	SocketMap = {},
	joinroom = (socket, room) => {
		socket.join(room);
		SocketMeta[socket.id].rooms[room] = true;
	},
	leaveroom = (socket, room) => {
		socket.leave(room);
		delete SocketMeta[socket.id].rooms[room];
	},
	authGuest = socket => {
		socket.emit('auth-guest', _respond({ clientid: socket.id }));
	};
io.on('connection', function(socket){
	//log('> Incoming connection');
	let User = { id: getGuestID(socket) },
		isGuest = () => typeof User.role === 'undefined',
		userlog = function(msg){ log('['+User.id+';'+socket.id+'] '+msg) },
		authByCookie = () => {
			let access = findAuthCookie(socket);
			if (access === config.WS_SERVER_KEY){
				User = { id: 'Web Server', role: 'server'};
				userlog('> Authenticated');
			}
			else if (typeof access === 'string' && access.length){
				let token = sha256hash(access);
				Database.query('SELECT u.* FROM users u LEFT JOIN sessions s ON s.user_id = u.id WHERE s.token = $1', [token], queryhandle(function(result){
					if (typeof result[0] !== 'object'){
						authGuest(socket);
						return;
					}

					User = result[0];

					let isServer = User.role === 'server';
					if (!isServer){
						joinroom(socket, User.id);
						//userlog('> Authenticated');
					}
					socket.emit('auth', _respond({ name: User.name, clientid: socket.id }));
					writeMeta('username', User.name);
					if (!isServer)
						pleaseNotify(socket, User.id);
				}));
			}
			else authGuest(socket);
		},
		writeMeta = (key, data) => {
			SocketMeta[socket.id][key] = data;
		},
		clearMeta = (key) => {
			delete SocketMeta[socket.id][key];
		};
	SocketMeta[socket.id] = {
		rooms: {},
		ip: socket.request.connection.remoteAddress,
		connected: moment(),
	};
	SocketMap[socket.id] = socket;

	authByCookie();

	socket.on('navigate',function(data){
		writeMeta('page',data.page);
	});
	socket.on('notify-pls',function(data, fn){
		if (User.role !== 'server')
			return respond(fn);

		userlog('> Sent notification count to '+data.user);

		data = json_decode(data);
		pleaseNotify(socket.in(data.user), data.user);
	});
	socket.on('mark-read',function(data, fn){
		if (User.role !== 'server')
			return respond(fn);

		data = json_decode(data);
		Database.query('UPDATE notifications SET read_at = NOW(), read_action = $2 WHERE id = $1', [data.nid, data.action], queryhandle(function(){

			userlog('> Marked notification #'+data.nid+' read');

			Database.query('SELECT u.id FROM users u LEFT JOIN notifications n ON n.recipient_id = u.id WHERE n.id = $1', [data.nid], queryhandle(function(result){
				let userid = result[0].id;

				pleaseNotify(socket.in(userid), userid);
			}));
		}));
	});
	socket.on('unauth',function(data, fn){
		if (isGuest())
			return respond(fn);

		let oldid = User.id;
		User = { id: getGuestID(socket) };
		leaveroom(socket, oldid);
		clearMeta('username');
		userlog(`> Unauthenticated (was ${oldid})`);
		respond(fn, true);
		authGuest(socket);
	});
	socket.on('status',function(data, fn){
		if (config.LOCALHOST !== true)
			return respond(fn, 'This can only be used in local mode');

		respond(fn, { User, rooms: Object.keys(SocketMeta[socket.id].rooms) });
	});
	const postaction = (what) => function(data){
		if (User.role !== 'server')
			return;

		data = json_decode(data);
		userlog(`> Post ${what.replace(/e?$/,'ed')} (${data.type}-${data.id})`);
		socket.in(POST_UPDATES_CHANNEL).emit('post-'+what,data);
	};
	socket.on('post-add',postaction('add'));
	socket.on('post-update',postaction('update'));
	socket.on('post-delete',postaction('delete'));
	socket.on('post-break',postaction('break'));
	socket.on(POST_UPDATES_CHANNEL,function(data, fn){
		if (User.role === 'server')
			return respond(fn);

		let action;
		switch(data){
			case "true":
				joinroom(socket, POST_UPDATES_CHANNEL);
				action = 'Joined';
			break;
			case "false":
				leaveroom(socket, POST_UPDATES_CHANNEL);
				action = 'Left';
			break;
			default: return;
		}
		let msg = action+' '+POST_UPDATES_CHANNEL+' broadcast channel';
		return respond(fn, msg, 1);
	});
	socket.on(ENTRY_UPDATES_CHANNEL,function(data, fn){
		if (User.role === 'server')
			return respond(fn);

		let action;
		switch(data){
			case "true":
				joinroom(socket, ENTRY_UPDATES_CHANNEL);
				action = 'Joined';
			break;
			case "false":
				leaveroom(socket, ENTRY_UPDATES_CHANNEL);
				action = 'Left';
			break;
			default: return;
		}
		let msg = action+' '+ENTRY_UPDATES_CHANNEL+' broadcast channel';
		return respond(fn, msg, 1);
	});
	socket.on('entry-score',function(data){
		if (User.role !== 'server')
			return;

		data = json_decode(data);
		userlog(`> Entry #${data.entryid} score change`);
		socket.in(ENTRY_UPDATES_CHANNEL).emit('entry-score',data);
	});
	socket.on('devquery',function(params, fn){
		if (User.role !== 'developer')
			return respond(fn);

		params = json_decode(params);

		switch (params.what){
			case "status":
				let conns = {};
				_.each(io.sockets.connected, (v, k) => {
					if (k === socket.id && !config.LOCALHOST)
						return;

					conns[k] = SocketMeta[v.id];
					if (typeof conns[k].connected !== 'undefined')
						conns[k].connectedSince = conns[k].connected.fromNow();
				});
				respond(fn, {
					clients: conns,
				});
			break;
			default:
				respond(fn, 'Unknown type '+params.what);
		}
	});
	socket.on('devaction',function(params, fn){
		if (User.role !== 'developer')
			return respond(fn);

		params = json_decode(params);
		if (typeof params.clientId !== 'string'){
			return respond(fn, 'Invalid client ID');
		}
		if (!(params.clientId in SocketMap)){
			if (params.clientId === 'self')
				params.clientId = socket.id;
			else return respond(fn, 'Invalid client ID');
		}

		const target = SocketMap[params.clientId];
		delete params.clientId;

		target.emit('devaction',params);
		respond(fn, true);
	});
	socket.on('hello',function(params, fn){
		if (User.role !== 'server')
			return respond(fn);

		params = json_decode(params);

		if (params.clientid in SocketMap)
			return SocketMap[params.clientid].emit('hello',  _respond({ priv: params.priv }));

		log(`Client ${params.clientid} not found among connected clients`);
	});
	socket.on('disconnect', function(){
		delete SocketMeta[socket.id];
		delete SocketMap[socket.id];

		if (isGuest() || User.role !== 'server')
			return;

		userlog('> Disconnected');
	});
});
