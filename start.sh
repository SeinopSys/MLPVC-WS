#! /bin/bash
git reset HEAD --hard
git pull
yarn install
forever list | grep server.js && forever stop server.js
forever start server.js
forever list
