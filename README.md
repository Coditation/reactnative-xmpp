# ReactNative-XMPP
XMPP module for React Native

This module is a work in progress and is a barebones XMPP client module at the moment. It should be enough to get some functional XMPP implementation in React Native started. Our development team intends to continue contributing towards further development of the module in coming days and months. Following is a very high level and a draft roadmap for the lib -

- Add unit tests
- Support SASL and Digest-MD5 based Auth. The lib/module currently supports plain auth.
- Implement handling of use-cases such as MUC Invitation, Subscription IQ etc.
- Fork/branch to implement new template driven design
- Achieve feature complete wrt core XMPP spec and XMPP MUC specs

# Using ReactNative-XMPP

- Install rn-nodeify globally (https://github.com/mvayngrib/rn-nodeify) ``` npm install -g rn-nodeify ```
- Install reactnative-xmpp: ``` npm install https://github.com/Coditation/reactnative-xmpp ```
- Run ``` rn-nodeify --install buffer,events,process,stream,util,inherits,fs,path --hack ```
- If you face Sockets Undefined issue somewhere in react-native-socket, do following: Open XCode, remove libTcpSockets.a and re-add it. Run ``` rnpm link react-native-tcp ```


# Sample Code

```
import React, { Component } from 'react';
import {
  AppRegistry,
  StyleSheet,
  Text,
  View
} from 'react-native';

global.Buffer = global.Buffer || require('buffer').Buffer

 var xmpp = require('reactnative-xmpp');
    // Use canonicalHost as the host name on the Jabber server and when you need to connect to any host 
    // other than localhost
    var conf = {login: 'user2',
                password: 'Chelsea@100',
                domain: 'localhost',
                host: 'localhost',
                canonicalHost: 'localhost'};
    var client = new xmpp.Client(conf);


    client.on('ready', function () {
      setTimeout(function () {
        for(var i = 0; i < client.roster.length; i++) {
          console.log(client.roster[i].getAttribute('jid'));

          if(client.roster[i].getAttribute('jid') === 'user3@localhost') {
            client.write('<presence to="'+ client.roster[i].getAttribute('jid') +'" type="subscribe" />');

            client.subscribe(client.roster[i].getAttribute('jid'), 'Friends', null, function(elt) {
              console.log("Subscribe response: " + elt);
            })
          }

        }              
      }, 1000);
    });

    client.on('presence.subscribe',function(element) {
      client.write('<presence to="'+ element.getAttribute('from') +'" type="subscribed" />');
    });

    client.on('ready', function() {
      client.join('testroom@conference.localhost', 'chetans', function(elem) {
        console.log(elem)
      });
    })
    


class reactnativexmpp extends Component {
  render() {
    return (
      <View style={styles.container}>
        <Text style={styles.welcome}>
          Welcome to React Native!
        </Text>
        <Text style={styles.instructions}>
          To get started, edit index.ios.js
        </Text>
        <Text style={styles.instructions}>
          Press Cmd+R to reload,{'\n'}
          Cmd+D or shake for dev menu
        </Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5FCFF',
  },
  welcome: {
    fontSize: 20,
    textAlign: 'center',
    margin: 10,
  },
  instructions: {
    textAlign: 'center',
    color: '#333333',
    marginBottom: 5,
  },
});

AppRegistry.registerComponent('reactnativexmpp', () => reactnativexmpp);

```
