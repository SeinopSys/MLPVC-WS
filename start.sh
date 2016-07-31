#! /bin/bash
git reset HEAD --hard
git pull
forever list | grep server.js && forever stop server.js
forever start server.js
forever list
