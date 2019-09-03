// jshint strict:false,-W079
process.title = 'MLPVC-WS';

const
	fs = require('fs'),
	pg = require('pg'),
	_ = require('lodash'),
	config = require('./config'),
	moment = require('moment-timezone'),
	SocketIO = require('socket.io'),
	express = require('express'),
	https = require('https'),
	cors = require('cors'),
	cloudflareExpress = require('cloudflare-express'),
	createHash = require('sha.js'),
	sha256hash = data => createHash('sha256').update(data, 'utf8').digest('hex'),
	POST_UPDATES_CHANNEL = 'post-updates',
	ENTRY_UPDATES_CHANNEL = 'entry-updates',
	log = text => console.log(moment().format('YYYY-MM-DD HH:mm:ss.SSS')+' | ' + text);

let Database = new pg.Client(`postgres://${config.DB_USER}:${config.DB_PASS}@${config.DB_HOST}/mlpvc-rr`),
	app = express();

// CORS
app.use(cors({ origin: config.ORIGIN_REGEX }));

app.use(cloudflareExpress.restore({update_on_start:true}));

app.get('/', function (req, res) {
	res.sendStatus(403);
});

let server;
server = https.createServer({
	cert: fs.readFileSync(config.SSL_CERT),
	key: fs.readFileSync(config.SSL_KEY),
}, app);
server.listen(config.PORT);
let io = SocketIO.listen(server);
io.origins(function(origin, callback){
	if (!config.ORIGIN_REGEX.test(origin))
		return callback('origin not allowed', false);
	callback(null, true);
});
log(`[Socket.io] Server listening on port ${config.PORT}`);

moment.locale('en');
moment.tz.add('Europe/Budapest|CET CEST|-10 -20|01010101010101010101010|1BWp0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00 11A0 1o00 11A0 1o00 11A0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00 11A0 1o00|11e6');
moment.tz.setDefault('Europe/Budapest');
const _respond = (message, status, extra) => {
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
		_.assignIn(response, extra);
	return response;
};
const respond = (fn, ...rest) => {
	if (typeof fn !== 'function')
		return;
	fn(JSON.stringify(_respond(...rest)));
};
const handleQuery = f =>
	function(err, result){
		if (err) {
	      return console.error('error running query', err);
	    }
	    f(result.rows, result);
	};
function pleaseNotify(socket, userId){
	Database.query('SELECT COUNT(*) as cnt FROM notifications WHERE recipient_id = $1 AND read_at IS NULL', [userId], handleQuery(result => {
		if (typeof result[0] !== 'object')
			return;

		socket.emit('notif-cnt', _respond({ cnt: parseInt(result[0].cnt,10) }));
	}));
}
const decodeJson = data => typeof data === 'string' ? JSON.parse(data) : data;
const findAuthCookie = socket =>{
	if (!socket.handshake.headers.cookie || !socket.handshake.headers.cookie.length)
		return;
	let cookieArray = socket.handshake.headers.cookie.split('; '),
		cookies = {};
	for (let i=0; i<cookieArray.length; i++){
		let split = cookieArray[i].split('=');
		cookies[split[0]] = split[1];
	}
	return cookies.access;
};
const getGuestID = socket => `Guest#${socket.id}`;
const findRealIp = require('./real-ip');

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
				Database.query('SELECT u.* FROM users u LEFT JOIN sessions s ON s.user_id = u.id WHERE s.token = $1', [token], handleQuery(result => {
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
		ip: findRealIp(socket),
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

		data = decodeJson(data);
		pleaseNotify(socket.in(data.user), data.user);
	});
	socket.on('mark-read',function(data, fn){
		if (User.role !== 'server')
			return respond(fn);

		data = decodeJson(data);
		Database.query('UPDATE notifications SET read_at = NOW(), read_action = $2 WHERE id = $1', [data.nid, data.action], handleQuery(() => {
			userlog('> Marked notification #'+data.nid+' read');

			Database.query('SELECT u.id FROM users u LEFT JOIN notifications n ON n.recipient_id = u.id WHERE n.id = $1', [data.nid], handleQuery(result => {
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
	const postaction = what => function(data){
		if (User.role !== 'server')
			return;

		data = decodeJson(data);
		userlog(`> Post #${data.id} ${what.replace(/e?$/,'ed')}`);
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

		data = decodeJson(data);
		userlog(`> Entry #${data.entryid} score change`);
		socket.in(ENTRY_UPDATES_CHANNEL).emit('entry-score',data);
	});
	socket.on('devquery', (params, fn) => {
		if (User.role !== 'developer')
			return respond(fn);

		params = decodeJson(params);

		switch (params.what){
			case "status":
				let conns = {};
				_.forEach(io.sockets.connected, (v, k) => {
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
	socket.on('hello',function(params, fn){
		if (User.role !== 'server')
			return respond(fn);

		params = decodeJson(params);

		if (params.clientid in SocketMap)
			return SocketMap[params.clientid].emit('hello',  _respond({ priv: params.priv }));

		log(`Client ${params.clientid} not found among connected clients`);
	});
	socket.on('update',function(params, fn){
		if (User.role !== 'server')
			return respond(fn);

		io.emit('update',params);
	});
	socket.on('disconnect', function(){
		delete SocketMeta[socket.id];
		delete SocketMap[socket.id];

		if (isGuest() || User.role !== 'server')
			return;

		userlog('> Disconnected');
	});
});
