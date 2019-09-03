'use strict';

// jshint -W079
const
  fetch = require('node-fetch'),
  ipRangeCheck = require('range_check'),
  log = require('./log');
const cloudflareIpRanges = { ipv4: [], ipv6: [], fetched: false };

const getIPs = () => Promise.all([
  fetch('https://www.cloudflare.com/ips-v4').then(r => r.text()),
  fetch('https://www.cloudflare.com/ips-v6').then(r => r.text()),
]).then((data) => {
  const [ipv4, ipv6] = data.map(list => list.slice(0, -1).split('\n'));
  return { ipv4, ipv6 };
});

const fetchPromise = getIPs().then(data => {
  cloudflareIpRanges.ipv4 = data.ipv4;
  cloudflareIpRanges.ipv6 = data.ipv6;
  cloudflareIpRanges.fetched = true;
  log(`[real-ip] Got ${cloudflareIpRanges.ipv4.length} v4 and ${cloudflareIpRanges.ipv6.length} v6 CloudFlare ranges`);
  return Promise.resolve();
});

const findRealIp = async socket => {
  if (!cloudflareIpRanges.fetched) {
    await fetchPromise;
  }
  let ip = socket.request.connection.remoteAddress.replace(/^::ffff:([\d.]+)$/, '$1');
  const cfIp = socket.client.request.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string'){
    try {
      const storedIp = ipRangeCheck.storeIP(cfIp);
      const ipVersion = `ip${ipRangeCheck.ver(storedIp)}`;
      if (ipRangeCheck.inRange(ip, cloudflareIpRanges[ipVersion]))
        ip = cfIp;
    } catch (e){
      console.error(`Invalid CloudFlare IP received: ${cfIp} (${e.toString()})\n${e.stack}`);
    }
  }
  return ip;
};

module.exports = findRealIp;
