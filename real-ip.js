'use strict';

// jshint -W079
const
  fetch = require('node-fetch'),
  ipRangeCheck = require('range_check'),
  log = require('./log');
const state = { ranges: [], fetched: false };

const getIPs = () => Promise.all([
  fetch('https://www.cloudflare.com/ips-v4').then(r => r.text()),
  fetch('https://www.cloudflare.com/ips-v6').then(r => r.text()),
]).then((data) => {
  const [v4, v6] = data.map(list => list.slice(0, -1).split('\n'));
  return [...v4, ...v6];
});

const fetchPromise = getIPs().then(data => {
  state.ranges = data;
  state.fetched = true;
  log(`[real-ip] Got ${state.ranges.length} CloudFlare ranges`);
  return Promise.resolve();
});

const findRealIp = async socket => {
  if (!state.fetched){
    await fetchPromise;
  }
  let remoteAddress = ipRangeCheck.storeIP(socket.request.connection.remoteAddress);
  const cfConnectingIp = ipRangeCheck.storeIP(socket.client.request.headers['cf-connecting-ip']);
  if (typeof cfConnectingIp === 'string'){
    try {
      if (ipRangeCheck.inRange(remoteAddress, state.ranges))
        remoteAddress = cfConnectingIp;
    } catch (e){
      console.error(`Invalid CloudFlare IP received: ${remoteAddress} (${e.toString()})\n${e.stack}`);
    }
  }
  return remoteAddress;
};

module.exports = findRealIp;
