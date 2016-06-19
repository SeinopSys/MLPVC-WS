@echo off
call forever stop server.js
forever start server.js
forever list
