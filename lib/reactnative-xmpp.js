import {AsyncStorage, Alert} from 'react-native';
import StreamEnabledSendMessage from './commands/stream_enabled_send_message'
import JoinGroup from './commands/join_group'
import Command from './commands/command'
import GenericXmppCommand from './commands/generic_xmpp_command'

const XMPP_STATE = {
  CONNECTING : 'connecting',
  CONNECTED : 'connected',
  READY : 'ready',
  SOFT_DISCONNECTED : 'soft_disconnected',
  DISCONNECTING : 'disconnecting',
  DISCONNECTED : 'disconnected'
}

var sys     = require('util')
  , ws     = null
  , events  = require('events').EventEmitter
  , sax = require("node-xml")
  , Element = require('./utils').Element
  , package_properties = require('../package.json')
  , AsyncStorageBackedQueue = require('./async-storage-backed-queue')
  , PersistentQueue = require('./persistent-queue')
  , uuidv5 = require('uuid/v5')
  , XMLParser = require('react-xml-parser') 
  Buffer = require('buffer');


var NS_SASL = 'urn:ietf:params:xml:ns:xmpp-sasl'
  , NS_BIND = 'urn:ietf:params:xml:ns:xmpp-bind'
  , NS_SESSION = 'urn:ietf:params:xml:ns:xmpp-session'
  , NS_CLIENT = 'jabber:client'
  , NS_XHTML = 'http://www.w3.org/1999/xhtml'
  , NS_XHTML_IM = 'http://jabber.org/protocol/xhtml-im'
  , NS_TLS = 'urn:ietf:params:xml:ns:xmpp-tls'
  , NS_STREAMS = 'http://etherx.jabber.org/streams'
  , NS_ROSTER = 'jabber:iq:roster'
  , NS_VCARD = 'vcard-temp'
  , NS_SOFT_VERSION = 'jabber:iq:version'
  , NS_LAST_SRV_RCV = 'jabber:iq:last'
  , NS_TIME = 'urn:xmpp:time'
  , NS_MUC = 'http://jabber.org/protocol/muc#user'
  , NS_STREAM_MANAGEMENT = 'urn:xmpp:sm:3'
  , PONG_ID = 'c2s1'


  , BROCKER_ACK_QUEUE_NAME = 'brocker_ack_queue'
  , END_TO_END_ACK_QUEUE_NAME = 'end_to_end_ack_queue'
  , BROKER_WAITING_STATUS = "BROKER_WAITING"
  , BROCKER_UNACK_STATUS = 'BROCKER_UNACK'
  , BROCKER_ACK_STATUS = 'BROCKER_ACK'
  , BROCKER_FAILED_STATUS = 'BROCKER_FAILED'
  , PARTIAL_RECIPIENT_ACK_STATUS = 'PARTIAL_RECIPIENT_ACK'
  , RECIPIENT_ACK_STATUS = 'RECIPIENT_ACK'
  , UUID_GENERATION_DOMAIN = 'SUNRISEHEALTH.CO'
  , BROCKER_ACKD_MESSAGE = 'brocker_ackd'
  , END_TO_END_PARTIAL_ACKD = 'end_to_end_partial_ackd'
  , END_TO_END_ACKD = 'end_to_end_ackd'


  , conn
  , xml_parser
  , stream_events_manager
  , brocker_ack_enabled
  , end_to_end_ack_enabled
  , brocker_ack_queue
  , end_to_end_ack_queue
  , config
  , ack_timeout
  , ping_timeout
  , retry_timeout
  , ping_retry = 1
  , xmpp_state = XMPP_STATE.DISCONNECTED;


/*************************************************************************
API
*************************************************************************/

const COMMAND_QUEUE_NAME = '__persistent_command_queue';

const COMMAND_TYPES = {
  STREAM_SEND_MESSAGE : 'stream_send_message',
  XMPP_COMMAND : 'xmpp_command',
  JOIN_GROUP : 'join_group'
}

const ENUMS = {
 EVENT_CONNECTED: 'event_connected',
 EVENT_DISCONNECTED: 'event_disconnected',
 EVENT_SOFT_CONNECTION_CONNECTED: 'event_soft_connection_connected',
 EVENT_SOFT_CONNECTION_DISCONNECTED: 'event_soft_connection_disconnected',
 EVENT_MESSAGE_SENT: 'event_message_sent',
 EVENT_MESSAGE_BROKER_ACKED: 'event_message_broker_acked',
 EVENT_GROUP_JOINED: 'group_joined'
};

/**
 * == React Native XMPP ==
 * XMPP library for React Native
 *
 **/

/** section: React Native XMPP
 * class Client
 *
 * Here is the XMPP client class. Each instances inherits EventEmiter methods. Events are :
 * - `message`, parameters are : `from`, `message`, `receiver`, `message_type`, `message_id`
 * - `message.sent`, parameters are : `to`, `message`
 * - `presence`, parameters are : `from`, `to`, `status`, `priority`, `type`
 * - `ready`, no parameters : called when session start.
 **/

/**
 * new Client([conf])
 * - conf (Object): hash with following keys :
 `login`, `password`, `domain`, `host`, `port`, `resource`, `status`, 'brocker_ack_enabled,
 ', 'end_to_end_ack_enabled'
 *
 * Example of usage :
 *
 *     var xmpp = require('reactnative-xmpp');
 *     var conf = {login: 'user',
 *                 password: 'pass',
 *                 domain: 'server.com'};
 *     var client = new xmpp.Client(conf);
 *     client.on('message', doSomeStuff);
 *
 *
 **/
Client = function (conf) {

  var self = this, mechanisms = [];

  function setID (attrs) {
    self.id = attrs.id;
  }

  function sasl () {
    try{
      if (mechanisms.indexOf('PLAIN')) {
        self.write("<auth xmlns='" + NS_SASL + "' mechanism='PLAIN'>"
                   + (new Buffer.Buffer('\x00' + conf.login + '\x00' + conf.password)).toString('base64') + "</auth>");
      }
      else {
        self.write("<auth xmlns='" + NS_SASL + "' mechanism='DIGEST-MD5' />");
        stream_events_manager.once('end|challenge|' + NS_SASL, onChallengeReceived);
      }
    }catch(e){
      // close socket
    }
  }

  function onResponseReady (response) {
    try{
      self.write("<response xmlns='" + NS_SASL + "'>" + response + "</response>");
      stream_events_manager.once('end|failure|' + NS_SASL, onChallengeFailed);
      stream_events_manager.once('end|challenge|' + NS_SASL, onChallengeSuccess);
    }catch(e){

    }
  }

  function onChallengeFailed () {
    //throw new Error('md5-digest challenge failed (bad login/password ?)');
    self.emit('message.error',new Error('md5-digest challenge failed (bad login/password ?)'));
  }

  function onChallengeSuccess () {
    try{
      self.write("<response xmlns='" + NS_SASL + "'/>");
    }
    catch(e){

    }
  }

  function setMechanism (element) {
    mechanisms.push(element.nodeValue);
  }

  function initiateSession () {
    try{
      self.write('<stream:stream to="' + (conf.canonicalHost || conf.host) + '" '
                 + 'xmlns="' + NS_CLIENT + '" '
                 + 'xmlns:stream="' + NS_STREAMS + '" '
                 + 'version="1.0" >');
    }catch(e){

    }
  }

  function resourceBindings () {
    self.sendIq({type: 'set'}, '<bind xmlns="' + NS_BIND + '"><resource>' + conf.resource + "</resource></bind>", function(elt) {
      sessionBindings();
    });
  }

  function sessionBindings () {
    self.sendIq({type: 'set'}, '<session xmlns="' + NS_SESSION + '"></session>', function(elt) {
      enableStreamManagement();
    });
  }

  function enableStreamManagement() {
    self.write('<enable xmlns="' +  NS_STREAM_MANAGEMENT + '"/>');
  }

  function onStreamManagementEnabled() {
    sendPresenceInformation();
  }

  function onAcknowledgementRecived(data) {
    resetTimeouts()
    if (xmpp_state == XMPP_STATE.READY || xmpp_state == XMPP_STATE.SOFT_DISCONNECTED) {
      console.log(`sunrise : message acknowledged ${self.unacked_command}`);
      if(self.unacked_command) {
        switch(self.unacked_command.command_type) {
          case COMMAND_TYPES.STREAM_SEND_MESSAGE:
            var command = self.unacked_command.command 
            self.brocker_ack_queue.dequeue_element(command.data.newId, 'id');
            command.data.status = BROCKER_ACK_STATUS;
            self.command_queue.remove(self.unacked_command);
            self.emit(BROCKER_ACKD_MESSAGE, {to:command.to, message:command.message, data:command.data}); 
          break
          // case COMMAND_TYPES.JOIN_GROUP:
          //   self.emit('group_joined',self.unacked_command.command.room);
          // break
        }        
        self.unacked_command = undefined;
      }
      self.try_deque_command();
    }    
  }

  function onPong() {
    resetTimeouts()
    self.set_xmpp_state(XMPP_STATE.READY)
    if(self.unacked_command) {
      self.execute_command();
    }
    else {
      self.try_deque_command();
    }
    self.emit('soft_connected')
  }

  function resetTimeouts(argument) {
    clearTimeout(ack_timeout);
    clearTimeout(ping_timeout);
    ping_timeout = undefined;
    ack_timeout = undefined;
    ping_retry = 1
  }

  function sendPresenceInformation () {
    self.getRoster(function () {
      self.setStatus('chat', conf.status);
      self.emit('ready');
      retry_timeout = setTimeout(() => {
        self.try_deque_command()
      }, 10 * 1000)
      self.set_xmpp_state(XMPP_STATE.READY)
    });
  }

  function onMessageReceive (attrs) {

    function onBodyReceived (element) {
      var data = {}; // create an empty array
      var length = element.parent.children.length;

      if(length > 1){
        for(var i = 0 ; i < (length-1) ; i++){
          data.nodeValue = element.parent.children[length-1].nodeValue;
        }
      }
      else {
        data.nodeValue = element.parent.children[length-1].nodeValue;
      }

      data.fromValue = element.parent.getAttribute("from");
      data.timeStamp = element.parent.getAttribute("timeStamp");
      data.newId = element.parent.getAttribute("newId");

      // var no = Math.floor((Math.random() * 10) + 1);
      //
      // if(no > 5) {
      // if (self.brocker_ack_enabled) {
      //   var dequeued_message = self.brocker_ack_queue.dequeue_element(data.newId, 'id');
      //   if(dequeued_message) {
      //     dequeued_message.status = BROCKER_ACK_STATUS;
      //     // self.end_to_end_ack_queue.queue_element(dequeued_message);
      //     self.emit(BROCKER_ACKD_MESSAGE, data);
      //     return
      //   }
      // }
      // }
      self.emit('message', element.parent);
    }

    function onHtmlBodyReceived (element) {
      self.emit('html.message', element.parent);
    }

    function onMessageReceived () {
      stream_events_manager.removeListener('end|body|' + NS_XHTML, onHtmlBodyReceived);
      stream_events_manager.removeListener('end|body|' + NS_CLIENT, onBodyReceived);
    }

    stream_events_manager.once('end|body|' + NS_XHTML, onHtmlBodyReceived);
    stream_events_manager.once('end|body|' + NS_CLIENT, onBodyReceived);
    stream_events_manager.once('end|message|' + NS_CLIENT, onMessageReceived);
  }

  function onPresenceReceive (attrs) {
    var status, priority = "";
    if ('type' in attrs && attrs.type == 'unavailable') {
      return;
    }

    function statusReceived (element) {
      status = element.nodeValue;
    }

    function priorityReceived (element) {
      priority = element.nodeValue;
    }

    function presenceReceived (element) {
      if(element.getAttribute('type') !== null && element.getAttribute('type') !== '') {
        self.emit('presence.'+ element.getAttribute('type'), element);
      }

      self.emit('presence.receive', element);
    }

    stream_events_manager.on('end|presence|' + NS_CLIENT, presenceReceived);
    stream_events_manager.on('end|priority|' + NS_CLIENT, priorityReceived);
    stream_events_manager.on('end|status|' + NS_CLIENT, statusReceived);
  }

  function starttls() {
    try{
      self.write('<starttls xmlns="' + NS_TLS + '" />');
      stream_events_manager.removeListener('start|mechanisms|' + NS_SASL, sasl);
      stream_events_manager.on('start|proceed|' + NS_TLS, proceedTls);
    }catch(e){

    }
  }

  function proceedTls () {
     conn.setSecure();
    initiateSession();
  }

  function sendSoftVersion () {
    self.sendIq({type: "result", from: self.jid},
                '<query xmlns="jabber:iq:version"><name>' + package_properties.name + '</name><version>' + package_properties.version + '</version></query>');
  }
  function sendLastServerResponse () {
    self.sendIq({type: "result", from: self.jid},
                '<query xmlns="jabber:iq:last" seconds="' + Math.round((+new Date - +self.last_time_received) / 1000) + '" />');
  }
  function sendLocalTime () {
    self.sendIq({type: "result", from: self.jid},
                '<time xmlns="urn:xmpp:time"><tzo>02:00</tzo><utc>' + (new Date).toISOString() + '</utc></time>');
  }
  function iqReceive (elt) {
    var id = elt.getAttribute('id');
    if (id == PONG_ID) {
      onPong();
      return
    }
    var type = elt.getAttribute('type');
    if (type === "set") {
      var query;
      if (query = elt.getElementsByTagNameNS('jabber:iq:roster', 'query')[0]) {
        var contact = query.getElementsByTagNameNS('jabber:iq:roster', 'item')[0]
          , update = false;
        self.roster.forEach(function (item, i) {
          if (item.getAttribute('jid') === contact.getAttribute('jid')) {
            self.roster[i] = contact;
            update = true;
          }
        });
        if (false === update) {
          self.roster.push(contact);
        }
      }
    }
    else {
      self.emit('iq|' + elt.getAttribute('id') + '|' + type, elt);
    }
  }

  function init() {
    //
    self.config = conf;
    self.jid = conf.login + '@' + conf.domain + '/' + conf.resource;

    ws = new WebSocket(`wss://${conf.host}:5280/websocket`);
    self.set_xmpp_state(XMPP_STATE.CONNECTING)
    self.brocker_ack_enabled = conf.brocker_ack_enabled || false
    self.end_to_end_ack_enabled = conf.end_to_end_ack_enabled || false

    if(self.brocker_ack_enabled) {
      self.brocker_ack_queue = conf.brocker_ack_queue;
    }

    self.command_queue = conf.persistent_queue;
    // TODO: Does this even work, where are we setting the XMPP Client?
    if(self.end_to_end_ack_enabled) {
      var config = {
        'retry_interval_sec':15,
        'queue_name':"end_to_end_ack_queue"
      }
      self.end_to_end_ack_queue = new AsyncStorageBackedQueue.AsyncStorageBackedQueue(config);
    }

    ws.onmessage = (data) => {
      if(data instanceof Object) {
        data = data.data;
      }
      this.last_time_received = new Date;
      var l = "<?xml version='1.0'?>".length;
      if(typeof data !== 'string') {
        data = data.toString();
      }
      if(typeof data === 'string') {
        if (data.substring(0, l) == "<?xml version='1.0'?>") {
          data = data.substring(l);
        }
        try{
          if(data){
            var parsedData = new XMLParser().parseFromString(data);
            var message_status = parsedData.getElementsByTagName('Status')
            if(message_status.length > 0){
              var group_name = parsedData.attributes.from
              var status_code = message_status[0].attributes.code
              if(status_code == "110" && group_name !== self.jid){
                self.emit('group_joined',group_name);
              }
            }
          }
        } catch(e) {
          // TODO: There is some issue parsing the message, this needs to be tackled by
          // sending an error to admin or something, at least message won't 
          // be lost
          // Alert.alert('sunrise',e)
        }
        parser.parseString(data);
      }
    };

    ws.onerror = (error) => {
      //setTimeout(init, timeout);
      self.emit('message.error',error.message);
    };

    ws.onclose = (error) => {
      clearTimeout(retry_timeout)
      resetTimeouts()
      self.set_xmpp_state(XMPP_STATE.DISCONNECTED)
      self.emit('close',error.message);
    };

    ws.onopen = () => {
      self.set_xmpp_state(XMPP_STATE.CONNECTED)
      try {
        self.write('<stream:stream to="' + (conf.canonicalHost || conf.host) + '" '
                 + 'xmlns="' + NS_CLIENT + '" '
                 + 'xmlns:stream="' + NS_STREAMS + '" '
                 + 'version="1.0" >');    
      } catch(e) {
        // we have not been able to take the init sequence ahead, close the socket
        ws.close();
      }

    };    
  }


  stream_events_manager = (new events)
    .once('start|stream|' + NS_STREAMS, setID)
    .once('start|success|' + NS_SASL, initiateSession)
    .once('start|bind|' + NS_BIND, resourceBindings)
    .once('start|presence|' + NS_CLIENT, onPresenceReceive)
    .once('end|mechanism|' + NS_CLIENT, setMechanism)
    .once('end|mechanisms|' + NS_SASL, sasl)
    .on('start|message|' + NS_CLIENT, onMessageReceive)
    .on('start|query|' + NS_SOFT_VERSION, sendSoftVersion)
    .on('start|query|' + NS_LAST_SRV_RCV, sendLastServerResponse)
    .on('start|time|' + NS_TIME, sendLocalTime)
    .on('end|iq|' + NS_CLIENT, iqReceive)
    .on('start|enabled|' + NS_STREAM_MANAGEMENT, onStreamManagementEnabled)
    .on('start|a|' + NS_STREAM_MANAGEMENT, onAcknowledgementRecived);

  stream_events_manager.setMaxListeners(50);

  if (false && conf && 'tls' in conf && conf.tls) {
    stream_events_manager.on('start|starttls|' + NS_TLS, starttls);
  }
  var parent_node = new Element('root'),
  current_node = null, value = '', cdata = '';


  var parser = new sax.SaxParser(function(cb) {
    cb.onStartDocument(function() {

    });
    cb.onEndDocument(function() {

    });
    cb.onStartElementNS(function(elem, attrs, prefix, uri, namespaces) {
       var name = '';
        name = elem;
        // xml_parser.current_elem = elt;
        if(current_node !== null) {
          parent_node = current_node;
          current_node = new Element(name, parent_node, attrs, prefix, uri);
        } else {
          current_node = new Element(name, parent_node, attrs, prefix, uri);
          parent_node = current_node;
        }
        var params = {};
        for (var key in attrs) {
          params[attrs[key].name] = attrs[key].value;
        }
        if(name === 'optional') name = 'session';
        stream_events_manager.emit('start|' + name + '|' + uri, params);
    });
    cb.onEndElementNS(function(elem, prefix, uri) {
        current_node.nodeValue = value;
        value = '';
        current_node.cdata = cdata;
        cdata = '';
        stream_events_manager.emit('end|' + elem + '|' + uri, current_node);
        current_node = parent_node = current_node.parent;
    });
    cb.onCharacters(function(chars) {
        value += chars;
    });
    cb.onCdata(function(cd) {
        cdata += cd;
    });
    cb.onComment(function(msg) {
        util.log('<COMMENT>'+msg+"</COMMENT>");
    });
    cb.onWarning(function(msg) {
        util.log('<WARNING>'+msg+"</WARNING>");
    });
    cb.onError(function(msg) {
        util.log('<ERROR>'+JSON.stringify(msg)+"</ERROR>");
        // self.emit('close');
    });
  });

  if (!conf || !("login" in conf) || !conf.login || conf.login.length < 1) {
    self.emit('message.error',new Error('Error login missing in the config'));
    //throw "[ error ] login missing in the config";
  }

  conf.status = conf.status || 'ready';
  conf.resource = conf.resource || package_properties.name;

  if ('host' in conf) {
    init();
  }
  else {
    self.emit('message.error',new Error('Host is missing in the config'));
    //throw "[ error] Host is missing in the config";
  }
};

sys.inherits(Client, events);

/**
 * Client#id -> Number
 *
 * Session id send by server.
 **/
Client.prototype.id = 0;

/**
 * Client#jid -> String
 *
 * Client jid : `user@domain/resource` define by configuration in constructor.
 **/
Client.prototype.jid = '';

/**
 * Client#last_time_received -> Date
 *
 * Date object to the last time anything has been received from server.
 **/
Client.prototype.last_time_received = new Date;

/**
 * Client#roster -> Array of Elements
 *
 * Client roster : Contact list.
 **/
Client.prototype.roster = null;

Client.prototype.conf = null;

Client.prototype.command_queue = undefined;

Client.prototype.unacked_command = undefined;

Client.prototype.xmpp_state = XMPP_STATE.DISCONNECTED;

Client.prototype.set_xmpp_state = function (state) {
  xmpp_state = state; 
}

Client.prototype.queue_command = function (command_type, command) {
  if (!command instanceof Command) {
    throw "This command is not supported";
  }

  this.command_queue.queue_element({command_type, command})
  this.try_deque_command()
}

Client.prototype.try_deque_command = function () {  
  if(this.unacked_command) {
    return
  }

  this.unacked_command = this.command_queue.next()  
  if (this.unacked_command) {
    this.execute_command()
  } 
}

Client.prototype.execute_command = function () {
  if(this.command_queue.should_retry_for_group(this.unacked_command.command.to)) {
    console.log("sunrise : sending stanza : ", this.unacked_command.command.stanza)
    this.write(this.unacked_command.command.stanza);    
    this.request_acknowledgement();
    switch(this.unacked_command.command_type) {
      case COMMAND_TYPES.STREAM_SEND_MESSAGE: 
      var command = this.unacked_command.command;
        this.emit('message.sent', command.to, command.message, command.data, true);
      break;
    }    
  }  
}

/**
 * Client#getRoster([callback]) -> Client
 * - callback (Function): a function called with roster in parameter
 *
 * Retrieve roster from server.
 **/
Client.prototype.getRoster = function (cb) {
  if (this.roster === null) {
    var self = this;
    return this.sendIq({type: 'get'}, '<query xmlns="' + NS_ROSTER + '" />', function (elt) {
      if(elt !== undefined)
        self.roster = elt.children[0].children;
      if (typeof cb == 'function') {
        cb(self.roster);
      }
    });
  }
  else {
    if (typeof cb == 'function') {
      cb(this.roster);
    }
  }
  return this;
};

/**
 * Client#getBareJid(jid) -> String
 * - jid (String): jid wich you want remove resource
 *
 * Remove resource information from a jid.
 **/
Client.prototype.getBareJid = function (long_jid) {
  var res = /([^\/]+)\//.exec(long_jid);
  if (res === null) {
    return false;
  }
  return res[1];
};


/**
 * Client#getVCard([to[, callback]]) -> Client
 * - to (String): a jid whose get vCard, if ommitted Client.jid is used
 * - callback (Function): a function called with xml element in parameter
 *
 * Call `callback` function with vCard's `to` as parameter.
 **/
Client.prototype.getVCard = function (to, cb) {
  var opts = {type: 'get'};
  if (to === null) {
    opts.from = jid;
  }
  else {
    opts.to = to;
  }
  this.sendIq(opts, '<vCard xmlns="' + NS_VCARD + '" />', function (element) {
    if (typeof cb == 'function') {
      cb(element.children[0]);
    }
  });
  return this;
};

/**
 * Client#push(to, str[, type]) -> Client
 * - to (String): receiver jid (ex: "john.doe@domain.com") to send message
 * - str (String): the message
 * - type (String): message type, default "chat", could be "groupchat" for MUC
 * - data (String): xml element to be added to the message
 *
 * Send instant message.
 **/
Client.prototype.push = function (to, str, type, data=undefined, is_retry=false, recipients=undefined) {
  var that = this;
  if (type === "groupchat") {
    var jid = this.getBareJid(to);
    if (typeof(jid) == "string") {
      to = jid
    }
  }

  str = escape(str);
  to = to.toLowerCase()

  if (!type) {
    type = "chat";
  }

  var raw = '<message from="' + this.jid + '" '
          + ' type="' + type + '"'
          + ' to="' + to + '"'
          + ' newId="' + data["newId"] + '"'
          + ' messageId="' + data["messageId"] + '"'
          + ' timeStamp="' + data["timeStamp"] + '"'
          + ' userColor="' + data["userColor"] + '"'
          + ' isImage="' + data["isImage"] + '"'+ '>'
          + '<body><![CDATA[' + str + ']]></body></message>';
  var messageSent = true
  
  if(this.brocker_ack_enabled) {
      if(!is_retry) {
   // Form the message to be stored in the queue
      var queued_message = {
        id: data.newId,
        to: to,
        str: str,
        type: type,
        message: data,
        status: BROCKER_UNACK_STATUS,
        recipients: recipients,
        recipients_ackd: [],
        send_timestamp: (new Date).getTime()
      };
      this.brocker_ack_queue.queue_element(queued_message);
    }
  }

  if (this.command_queue.check_if_command_queued(data["newId"])) {
    console.log(`sunrise : message alerady queued ${str} ${to}`);
    this.try_deque_command()
    return {
      message: "command already exist"
    }
  }

  data.status = BROCKER_UNACK_STATUS
  console.log(`sunrise : message queued ${str} ${to}`);
  var send_message_command = new StreamEnabledSendMessage(to, str, data, false, raw)
  this.queue_command(COMMAND_TYPES.STREAM_SEND_MESSAGE, send_message_command)
  
  return {
    message: "message queued successfully"
  }
}

/**
 * Client#pushHtml(to, str[, type]) -> Client
 * - to (String): a jid to send message
 * - str (String): the html message
 * - type (String): html message type, default "chat", could be "groupchat" for MUC
 *
 * Send HTML instant message.
 **/
Client.prototype.pushHtml = function (to, str, type, data = undefined) {
  if (type === "groupchat") {
    to = this.getBareJid(to);
  }

  str = escape(str);

  var raw = '<message from="' + this.jid + '" '
          + 'to="' + to +'" '
          + (typeof type === "string" ? ' type="' + type + '"' : ' type="chat"')
          + '>' + (data ? data : "") + '<body>' + str.replace(/(\<[^\>]+\>|\<\/[^\>]+\>|\<[^\>]+\/\>)/g, '') + '</body>'
          + '<html xmlns="' + NS_XHTML_IM + '">'
          + '<body xmlns="' + NS_XHTML + '">' + str + '</body></html></message>';
  try{
    this.write(raw);
  }catch(e){
    return {
      "error":e
    };
  }
  this.emit('html.message.sent', to, str);
  return this;
};

Client.prototype.request_acknowledgement = function() {
  this.write('<r xmlns="'+ NS_STREAM_MANAGEMENT +'"/>');
  this.start_ack_timeout();
}

Client.prototype.start_ack_timeout = function () {
  ack_timeout = setTimeout(() => {
    this.start_ping();
    this.emit('soft_disconnected');
    clearTimeout(retry_timeout)
    this.set_xmpp_state(XMPP_STATE.SOFT_DISCONNECTED)
  }, 10000);
}

Client.prototype.start_ping = function () {
  if(ping_retry == 6) {
    ping_retry = 1;
    this.emit('disconnected')
    clearTimeout(retry_timeout)
    return
  }
  this.send_ping()

  ping_timeout = setTimeout(() => {
    ping_retry++;
    this.start_ping()
  }, this.get_ping_timeout());
}

Client.prototype.get_ping_timeout = function () {
  var timeouts = [3, 5, 10, 15, 30];
  return timeouts[ping_retry-1] * 1000;
}

Client.prototype.send_ping = async function () {
  this.write("<iq from='"+ this.jid + "' id='c2s1' type='get'> <ping xmlns='urn:xmpp:ping'/> </iq>");
}

/**
 * Client#sendIq(attrs, content[, cb]) -> Client
 * - attrs (Object): request attributes
 * - content (String): content of request
 * - cb (Function): Callback function
 *
 * Internal use.
 **/
Client.prototype.sendIq = function (attrs, content, cb) {
  if (typeof this.sendIq.nb_req == 'undefined') {
    this.sendIq.nb_req = 0;
  }
  var id;
  id = 'req' + this.sendIq.nb_req++;
  attrs.id = id;
  var buffer = '<iq';
  for (var k in attrs) {
    if (attrs.hasOwnProperty(k)) {
      buffer += ' ' + k + '="' + attrs[k] + '"';
    }
  }
  try{
    this.writeDummy(buffer + '>' + content + '</iq>', function(response){
      if (typeof cb == 'function') {
        cb(response);
      }
    });
  }catch(e){
    return {
      "error":e
    };
  }
  if (typeof cb !== 'function') {
    return this;
  }
  var onReceive = function (elt) {
    this.removeListener('iq|' + id + '|result', onReceive);
    if (typeof cb == 'function') {
      cb(elt);
    }
  };
  this.once('iq|' + id + '|result', cb);
  return this;
};

/**
 * Client#setStatus([show[, status[, priority[, avatar_sha1]]]]) -> Client
 * - status (String): contains non-human-readable XML character data that specifies the particular availability status. Default : "chat".
 * - show (String): detailled description of an availability state. Default : "Interested in chatting".
 * - priority (Number): specify the priority level of the resource.
 * - avatar_sha1 (String): sha1 checksum of the avatar to use
 *
 * Set client status and priority.
 **/
Client.prototype.setStatus = function (show, status, priority, avatar_sha1) {
  var statuses = {"away": "Temporarily away",
                  "chat": "Interested in chatting",
                  "dnd": "Do not disturb",
                  "xa": "Extended away"};
  show = statuses[show] ? show : 'chat';
  status = status !== null ? status : statuses[show];
  priority = !isNaN(priority) ? priority : false;
  var buffer = '<presence from="' + this.jid + '">';
  buffer += '<show>' + show + '</show>';
  if (status) {
    buffer += '<status>' + status + '</status>';
  }
  if (priority) {
    buffer += '<priority>' + priority + '</priority>';
  }
  if (avatar_sha1) {
    buffer += '<x xmlns="vcard-temp:x:update"><photo>' + avatar_sha1 + '</photo></x>';
  }
  buffer += '</presence>';
  try{
    return this.write(buffer);
  }catch(e){
    return {
      "error":e
    };
  }
};

/**
 * Client#setVcard(vcard[, callback]) -> Client
 * - vcard (String): xml stream of the vcard
 * - callback (Function): callback with server's response in parameter
 *
 * Setup your vcard
 **/
Client.prototype.setVcard = function (vcard, cb) {
  var opts = {type: 'set'};
  this.sendIq(opts, '<vCard xmlns="' + NS_VCARD + '">' + vcard + '</vCard>', function (element) {
    if (typeof cb == 'function') {
      cb(element.children[0]);
    }
  });
  return this;
};

/**
 * Client#subscribe(to[, group[, name[, callback]]]) -> Client
 * - to (String): a jid to add to roadster
 * - group (String): the group, default "Group"
 * - name (String): Alias, default first argument
 * - callback (Function): callback with server's response in parameter
 *
 * Add somebody to your roster
 **/
Client.prototype.subscribe = function (to, group, name, cb) {
  group = group || 'Group';
  name = name || to;
  if (!(typeof cb === "function")) {
    cb = function () {};
  }
  this.sendIq({type: 'set'}, '<query xmlns="' + NS_ROSTER + '">'
                            +  '<item jid="' + to + '" '
                            +       'name="' + name + '">'
                            +    '<group>' + group + '</group>'
                            +  '</item>'
                            +'</query>', cb);

  try{
    return this.write('<presence to="'+ to +'" type="subscribe" />');
  }catch(e){
    return {
      "error":e
    };
  }
};

/**
 * Client#join(room, callback) -> Client
 * - room (String): A jid to add to room
 * - callback (Function): callback with server's response
 *
 * Add somebody to your roster
 **/
Client.prototype.join = function (room, nick, cb) {

  if (!(typeof cb === "function")) {
    cb = function () {};
  }
  try{
    var stanza = '<presence from="'+ this.jid +
                 '" to="'+ room.toLowerCase() + '/' + nick + 
                 '"><x xmlns="http://jabber.org/protocol/muc#user"><item affiliation="member" role="participant" /></x></presence>';
    this.write(stanza)
  }
  catch(e){
    return {
      "error":e
    };
  }
};

/**
 * Client#write(data) -> client
 * - data (String): raw data to send
 *
 * Write raw datas
 **/
Client.prototype.write = function (data) {
  try{    
    ws.send(data);
    return {
      "info":"Message sent successfully"
    }
  }catch(e){
    // return {
    //   "error":e
    // }
    return {
      "error":"Message delivery failed, please try again later."
    }
  }
  return this;
};

Client.prototype.writeDummy = function (data, cb) {
  try{
    ws.send(data);
  }catch(e){
    return {
      "error":e
    }
  }
  return this;
};

Client.prototype.disconnect = function() {
  try {
    this.set_xmpp_state(XMPP_STATE.DISCONNECTING)
    clearTimeout(retry_timeout)
    resetTimeouts()
    ws.close()
  }
  catch(e) {
    return {
      "error":e
    }
  }
  finally {
    conn = null;
  }
}

exports.Client = Client;
exports.AsyncStorageBackedQueue = AsyncStorageBackedQueue.AsyncStorageBackedQueue;
exports.NS_SASL = NS_SASL;
exports.NS_BIND = NS_BIND;
exports.NS_SESSION = NS_SESSION;
exports.NS_CLIENT = NS_CLIENT;
exports.NS_XHTML = NS_XHTML;
exports.NS_XHTML_IM = NS_XHTML_IM;
exports.NS_TLS = NS_TLS;
exports.NS_STREAMS = NS_STREAMS;
exports.NS_ROSTER = NS_ROSTER;
exports.NS_VCARD = NS_VCARD;
exports.NS_SOFT_VERSION = NS_SOFT_VERSION;
exports.NS_LAST_SRV_RCV = NS_LAST_SRV_RCV;
exports.NS_TIME = NS_TIME;
exports.NS_MUC = NS_MUC;
exports.BROCKER_ACK_QUEUE_NAME = BROCKER_ACK_QUEUE_NAME
exports.END_TO_END_ACK_QUEUE_NAME = END_TO_END_ACK_QUEUE_NAME
exports.BROCKER_UNACK_STATUS = BROCKER_UNACK_STATUS
exports.BROCKER_ACK_STATUS = BROCKER_ACK_STATUS
exports.BROCKER_FAILED_STATUS = BROCKER_FAILED_STATUS
exports.PARTIAL_RECIPIENT_ACK_STATUS = PARTIAL_RECIPIENT_ACK_STATUS
exports.RECIPIENT_ACK_STATUS = RECIPIENT_ACK_STATUS
exports.UUID_GENERATION_DOMAIN = UUID_GENERATION_DOMAIN
exports.BROCKER_ACKD_MESSAGE = BROCKER_ACKD_MESSAGE
exports.BROKER_WAITING_STATUS = BROKER_WAITING_STATUS
exports.END_TO_END_PARTIAL_ACKD = END_TO_END_PARTIAL_ACKD
exports.END_TO_END_ACKD = END_TO_END_ACKD
exports.COMMAND_TYPES = COMMAND_TYPES
exports.PersistentQueue = PersistentQueue.PersistentQueue;