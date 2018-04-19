#!/usr/bin/env bash
echo "##### post-receive hook #####"
read oldrev newrev refname
echo "Push triggered update to revision $newrev ($refname)"

CMD_PWD="cd .. && pwd"
CMD_FETCH="env -i git fetch"
CMD_YARN="sudo -u www-data yarn install --production"
CMD_STOP="sudo -u www-data pm2 stop pm2.json"
CMD_START="sudo -u www-data pm2 start pm2.json"

echo "$ $CMD_PWD"
eval $CMD_PWD
echo "$ $CMD_FETCH"
eval $CMD_FETCH
echo "$ $CMD_YARN"
eval $CMD_YARN
echo "$ $CMD_STOP"
eval $CMD_STOP
echo "$ $CMD_START"
eval $CMD_START

echo "##### end post-receive hook #####"
