"use strict";

const ipRangeCheck = require('range_check');
const cloudflareIpRanges = require('./cloudflare_ip.json');
const findRealIp = socket => {
	let ip = socket.request.connection.remoteAddress.replace(/^::ffff:([\d.]+)$/, '$1');
	const cfIp = socket.client.request.headers['cf-connecting-ip'];
	if (typeof cfIp === 'string') {
		try {
      const storedIp = ipRangeCheck.storeIP(cfIp);
      const ipVersion = `ip${ipRangeCheck.ver(storedIp)}`;
      if (ipRangeCheck.inRange(ip, cloudflareIpRanges[ipVersion]))
        ip = cfIp;
		}
		catch (e) {
		  console.error(`Invalid CloudFlare IP received: ${cfIp} (${e.toString()})\n${e.stack}`);
		}
	}
	return ip;
};

module.exports = findRealIp;
