module.exports = {
	DB_HOST: '',
	DB_USER: '',
	DB_PASS: '',
	WS_SERVER_KEY: '',
	ORIGIN_REGEX: /^(https:\/\/mlpvector\.lc|http:\/\/localhost)/,

	LE_SERVER: 'staging',
	LE_EMAIL: '',
	LE_DOMAINS: ['ws.mlpvector.lc'],
    CF_KEY: '',

	// For development only
	LOCALHOST: true,
	SSL_CERT: "/path/to/ssl.crt",
	SSL_KEY: "/path/to/ssl.key",
};
