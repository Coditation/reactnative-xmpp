import {AsyncStorage} from 'react-native';

var sys     = require('util')
  , tcp     = require('react-native-tcp')
  , events  = require('events').EventEmitter
  , sax = require("node-xml")
  , Element = require('./utils').Element
  , package_properties = require('../package.json')
  , AsyncStorageBackedQueue = require('./AsyncStorageBackedQueue')
  , uuidv5 = require('uuid/v5');


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


  , BROCKER_ACK_QUEUE_NAME = 'brocker_ack_queue'
  , END_TO_END_ACK_QUEUE_NAME = 'end_to_end_ack_queue'
  , BROKER_WAITING_STATUS = "BROKER_WAITING"
  , BROCKER_UNACK_STATUS = 'BROCKER_UNACK'
  , BROCKER_ACK_STATUS = 'BROCKER_ACK'
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
                   + (new Buffer('\x00' + conf.login + '\x00' + conf.password)).toString('base64') + "</auth>", function(e) {
      });
      }
      else {
        self.write("<auth xmlns='" + NS_SASL + "' mechanism='DIGEST-MD5' />", function(e) {
      });
        stream_events_manager.once('end|challenge|' + NS_SASL, onChallengeReceived);
      }
    }catch(e){

    }
  }

  function onChallengeReceived (element) {
    var x = 0;
    // md5dig.processing(element.nodeValue, {username: conf.login,
    //                                       realm: conf.domain,
    //                                       'digest-uri': 'xmpp/' + conf.domain,
    //                                       password: conf.password}, onResponseReady);
  }

  function onResponseReady (response) {
    try{
      self.write("<response xmlns='" + NS_SASL + "'>" + response + "</response>", function(e) {
      });
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
      self.write("<response xmlns='" + NS_SASL + "'/>", function(e) {
      });
    }catch(e){

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
                 + 'version="1.0" >', function(e) {
      });
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
      sendPresenceInformation();
    });
  }

  function sendPresenceInformation () {
    self.getRoster(function () {
      self.setStatus('chat', conf.status);
      self.emit('ready');
    });
  }

  function saveData(data){
    // (function(){
    //   AsyncStorage.getItem("logger1").then((dataLocal) => {
    //     if(dataLocal !== null){
    //       console.log(dataLocal);
    //       dataLocal = JSON.parse(dataLocal)
    //       dataLocal.push(data);
    //     }
    //     else {
    //       dataLocal = new Array();
    //       dataLocal.push(data);
    //     }

    //     console.log("dataLocal Array Local :");
    //     console.log(dataLocal);
    //     if(data === undefined){

    //     }
    //     else {
    //       AsyncStorage.setItem("logger1", JSON.stringify(dataLocal),
    //         () => {
    //           setTimeout(() => {
    //             //_this.checkForNewMessage();
    //           },200);
    //         },
    //         (error) => {
    //           console.log("Error while inserting data");
    //         });
    //       }

    //     });
    // }());
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
      if (self.brocker_ack_enabled) {
        var dequeued_message = self.brocker_ack_queue.dequeue_element(data.newId, 'id');
        if(dequeued_message) {
          dequeued_message.status = BROCKER_ACK_STATUS;
          // self.end_to_end_ack_queue.queue_element(dequeued_message);
          self.emit(BROCKER_ACKD_MESSAGE, data);
          return
        }
      }
      // }
      saveData(data);
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

  function starttls () {
    try{
      self.write('<starttls xmlns="' + NS_TLS + '" />', function(e) {
      });
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

  function init () {
    //
    self.jid = conf.login + '@' + conf.domain + '/' + conf.resource;
    conn = tcp.createConnection(conf.port || 5222, conf.host);
    self.brocker_ack_enabled = conf.brocker_ack_enabled || false
    self.end_to_end_ack_enabled = conf.end_to_end_ack_enabled || false

    if(self.brocker_ack_enabled) {
      self.brocker_ack_queue = conf.brocker_ack_queue;
    }

    if(self.end_to_end_ack_enabled) {
      var config = {
        'retry_interval_sec':15,
        'queue_name':"end_to_end_ack_queue"
      }
      self.end_to_end_ack_queue = new AsyncStorageBackedQueue.AsyncStorageBackedQueue(config);
    }

    conn.on("disconnect", function (error) {
      // self.emit('close');
    });

    conn.on("connect", function () {
      this.setTimeout(0);
      this.setEncoding("utf8");
      initiateSession();
    });

    conn.on("data", function (data) {
      this.last_time_received = new Date;
      var l = "<?xml version='1.0'?>".length;
      if(typeof data !== 'string') {
        data = data.toString();
      }
      if(typeof data === 'string') {
        if (data.substring(0, l) == "<?xml version='1.0'?>") {
          data = data.substring(l);
        }
        parser.parseString(data);
      }
    });

    conn.on("error", function (error) {
      var timeout = Math.round(Math.random() * 10 + 5) * 1000;
      //setTimeout(init, timeout);
      self.emit('message.error',error);
    });

    conn.on("close", function (error) {
      self.emit('close',error);
    });

    conn.on("end", function () {
      try{
        this.write('</stream:stream>', function(e) {
        });
      }catch(e){
        return {
          "error":e
        };
      }
      // self.emit('close');
    });
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
    .on('end|iq|' + NS_CLIENT, iqReceive);

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
    to = this.getBareJid(to);
  }

  str = escape(str);

  if (!type) {
    type = "chat";
  }

  var raw = '<message from="' + this.jid + '" '
          + ' type="' + type + '"'
          + ' to="' + to + '"'
          + ' newId="' + data[0]["newId"] + '"'
          + ' messageId="' + data[0]["messageId"] + '"'
          + ' timeStamp="' + data[0]["timeStamp"] + '"'
          + ' userColor="' + data[0]["userColor"] + '"'
          + ' isImage="' + data[0]["isImage"] + '"'+ '>'
          + '<body><![CDATA[' + str + ']]></body></message>';
  var messageSent = true
  try{
    if(this.brocker_ack_enabled) {
        if(!is_retry) {
     // Form the message to be stored in the queue
        var queued_message = {
          id: data[0].newId,
          to: to,
          str: str,
          type: type,
          message: data[0],
          status: BROCKER_UNACK_STATUS,
          recipients: recipients,
          recipients_ackd: [],
          send_timestamp: (new Date).getTime()
        };
        this.brocker_ack_queue.queue_element(queued_message);
      }
    }

    var response = this.write(raw, function(e) {
     messageSent = false
    });
    if ("error" in response) {
      messageSent = false
    }
  }catch(e){
    messageSent = false;
    var response = {};
    response.error = e;
    throw {
      "error":"Message delivery failed, please try again later."
    };
  }
  finally{
    data[0].status = BROCKER_UNACK_STATUS
    this.emit('message.sent', to, str, data,messageSent);
    if(messageSent){
      return response;
    }
    //return response;
    // throw {
    //   "error":e
    // };
  }
  // this.emit('message.sent', to, str, data,messageSent);
  //return response;
};

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
    this.write(raw, function(e) {
    });
  }catch(e){
    return {
      "error":e
    };
  }
  this.emit('html.message.sent', to, str);
  return this;
};

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
    return this.write(buffer, function(e) {
    });
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
    return this.write('<presence to="'+ to +'" type="subscribe" />', function(e) {
    });
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
    return this.write('<presence from="'+ this.jid +'" to="'+ room + '/' + nick + '"><x xmlns="http://jabber.org/protocol/muc#user"><item affiliation="member" role="participant" /></x></presence>', function(e) {
    });
  }catch(e){
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
    conn.write(data);
    return {
      "info":"Message sent successfully"
    }
  }catch(e){
    // return {
    //   "error":e
    // }
    throw {
      "error":"Message delivery failed, please try again later."
    }
  }
  return this;
};

Client.prototype.writeDummy = function (data, cb) {
  try{
    conn.write(data, function(response){
      if (typeof cb == 'function') {
        cb(response);
      }
    });
  }catch(e){
    return {
      "error":e
    }
  }
  return this;
};

Client.prototype.disconnect = function() {
  try {
    conn.end()
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
exports.PARTIAL_RECIPIENT_ACK_STATUS = PARTIAL_RECIPIENT_ACK_STATUS
exports.RECIPIENT_ACK_STATUS = RECIPIENT_ACK_STATUS
exports.UUID_GENERATION_DOMAIN = UUID_GENERATION_DOMAIN
exports.BROCKER_ACKD_MESSAGE = BROCKER_ACKD_MESSAGE
exports.BROKER_WAITING_STATUS = BROKER_WAITING_STATUS
exports.END_TO_END_PARTIAL_ACKD = END_TO_END_PARTIAL_ACKD
exports.END_TO_END_ACKD = END_TO_END_ACKD
