// Copyright 2016-2017 the project authors as listed in the AUTHORS file.
// All rights reserved. Use of this source code is governed by the
// license that can be found in the LICENSE file.
"use strict";

const fs = require('fs');
const https = require('https');
const mqtt = require('mqtt');
const path = require('path');
const readline = require('readline');
const socketio = require('socket.io');
const eventLog = require('./eventLog.js');


///////////////////////////////////////////////
// micro-app framework methods
///////////////////////////////////////////////
var Server = function() {
}

Server.getDefaults = function() {
  return { 'title': 'Universal IR' };
}


var replacements;
Server.getTemplateReplacments = function() {
  if (replacements === undefined) {
    const pageHeight = Server.config.windowSize.y;
    const pageWidth = Server.config.windowSize.x;

    // create the html for the divs
    const divs = new Array();
    divs[0] = '    <div id="logdata"' + ' style="position: absolute; ' +
                   'width:' + (pageWidth - 2) + 'px; ' +
                   'height:' + (pageHeight - 30) +  'px; '  +
                   'z-index: 1;' +
                   'top:' + '0px; ' +
                   'left:' + '1px; ' +
                   'background-color: white; ' +
                   'font-size:11px;' +
                   'overflow:auto;' +
                   '"></div>';

    var config = Server.config;
    replacements = [{ 'key': '<DASHBOARD_TITLE>', 'value': config.title },
                   { 'key': '<UNIQUE_WINDOW_ID>', 'value': config.title },
                   { 'key': '<CONTENT>', 'value': divs.join("\n")},
                   { 'key': '<PAGE_WIDTH>', 'value': pageWidth },
                   { 'key': '<PAGE_HEIGHT>', 'value': pageHeight }];
  }
  return replacements;
}

var mqttClients = new Array();
var state = new Object();
Server.startServer = function(server) {
  const config = Server.config;

  const eventSocket = socketio.listen(server);

  eventSocket.on('connection', function(ioclient) {
    const lineReader = readline.createInterface({
      input: fs.createReadStream(eventLog.getLogFileName(config))
    });
    lineReader.on('line', function(line) {
      eventSocket.to(ioclient.id).emit('eventLog', line);
    });

    const eventLogListener = function(message) {
      eventSocket.to(ioclient.id).emit('eventLog', message);
    }
    eventLog.addListener(eventLogListener);

    eventSocket.on('disconnect', function () {
      eventLog.removeListenter(eventLogListener);
    });
  });


  // connect to each of the configured mqtt servers
  for (var i = 0; i < config.mqtt.length; i++) {
    let mqttOptions;
    if (config.mqtt[i].serverUrl.indexOf('mqtts') > -1) {
      const certsPath = config.mqtt[i].certs;
      mqttOptions = { key: fs.readFileSync(path.join(__dirname, certsPath, '/client.key')),
                      cert: fs.readFileSync(path.join(__dirname, certsPath, '/client.cert')),
                      ca: fs.readFileSync(path.join(__dirname, certsPath, '/ca.cert')),
                      checkServerIdentity: function() { return undefined }
      }
    }

    mqttClients[i] = mqtt.connect(config.mqtt[i].serverUrl, mqttOptions);

    let subscribeFunction = mqttClients[i].subscribe.bind(mqttClients[i], config.mqtt[i].requestTopic);
    mqttClients[i].on('connect',function() {
      subscribeFunction();
    });

    mqttClients[i].on('message', function(mqttId, topic, message) {
      message = message.toString();
      eventLog.logMessage(config, message, eventLog.LOG_INFO);

      // send out the IR command for the requested command
      const commands = config.mqtt[mqttId].commands[message].concat();

      const sendCommand = function(commands, index) {
        if (!commands[index].skip) {
          const commandFile = path.join(__dirname, '../library', commands[index].command).toString() + '.json'; 
          const commandObj = require(commandFile); 
          mqttClients[mqttId].publish(commands[index].topic, commandObj.values.join(','));
        }
        if ((index + 1) < commands.length) {
          if ((commands[index].delay !== undefined ) && (!commands[index].skip)) {
            setTimeout(sendCommand.bind(null, commands, index + 1), commands[index].delay);
          } else {
            sendCommand(commands, index + 1);
          }
        }
      }

      let newState = new Object();
      if (commands !== undefined) {
        // adjust the commands based on the current state
        commands.forEach(function(command, index) {
          if (command.state) {
            const device = command.state.dev;
            if (state[device] && state[device][command.state.state]) {
              // remove this command as the device is already in the required state
              command.skip = true;

              // remove from existing state so we won't turn if off later
              delete state[device][command.state.state];
            }
            if (!newState[device]) {
              newState[device] = new Object();
            }
            newState[device][command.state.state] = true;
          }
        });

        // now turn off any devices that should no longer be on
        for (var device in state) {
          if (state[device]['power']) {
            commands.unshift(config.mqtt[mqttId].state[device]['power-off']);
          }
        };
        state = newState;

        if (commands.length > 0) {
          sendCommand(commands, 0);
        }
      } else {
        eventLog.logMessage(config, `Command not found: ${message}`, eventLog.LOG_INFO);
      } 
    }.bind(null, i));
  };
}


if (require.main === module) {
  var microAppFramework = require('micro-app-framework');
  microAppFramework(path.join(__dirname), Server);
}


module.exports = Server;
