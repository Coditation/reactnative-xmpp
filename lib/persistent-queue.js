import {InteractionManager, Text} from 'react-native';
import {AsyncStorage, Alert} from 'react-native';


PersistentQueue = function(config) {
  if(!config) {
    throw 'Queue config required';
  }
  this.queue_name = config.name;
  this.write_encrypted = config.write_encrypted
  this.encryptor = config.encryptor
  this.read_queue()
}

PersistentQueue.prototype.queue = []
PersistentQueue.prototype.queue_name = undefined
PersistentQueue.prototype.is_dirty = false
PersistentQueue.prototype.should_retry_for_group = undefined

PersistentQueue.prototype.dequeue_element = function(id, id_field) {
  var index = this.queue.map(function(el) {
      return el[id_field];
    }).indexOf(id);
    if(index != -1) {
      var dequeued_element = this.queue.splice(index, 1);
      this._persist_queue();
      return dequeued_element;
    }
    return undefined;
}

PersistentQueue.prototype.queue_element = function(new_element) {
  var element = this.queue.filter((element) => {
    return element.command.uuid == new_element.command.uuid
  })
  if (element.length > 0) {
    return
  }
  this.queue.push(new_element);
  this.is_dirty = true;
  this._persist_queue();
}

PersistentQueue.prototype.dequeue = function () {
  var element = this.queue.pop();
  this._persist_queue();
  return element;
}

PersistentQueue.prototype.filter = function(filter_fn) {
  var res = this.queue.filter(filter_fn);
  if(res && res.length > 0) {
    return res[0];
  }
  return undefined
}

PersistentQueue.prototype.length = function() {
  return this.queue.length
}

PersistentQueue.prototype.next = function() {
  for (var i = 0; i < this.queue.length; i++) {
    if(this.should_send_command(this.queue[i].command)) {
      return this.queue[i]
    }
  }
  return undefined
}

PersistentQueue.prototype.remove = function(element) {
  var index = this.queue.indexOf(element)
  if (index != -1) {
    this.queue.splice(index, 1)
  }
  this._persist_queue();
}

PersistentQueue.prototype.read_queue = function() {
  if (this.write_encrypted) {
    this.read_queue_decrypted()
  }
  else {
    this.read_queue_plain()
  }
}

PersistentQueue.prototype.read_queue_plain = function() {
   AsyncStorage.getItem(this.queue_name).then((data) => {
    if(data) {
      this.queue = JSON.parse(data);
    }
  });;
}

PersistentQueue.prototype.read_queue_decrypted = function() {
   AsyncStorage.getItem(this.queue_name).then((data) => {
    if(data) {
      var decrypted = this.encryptor.decrypt(data)
      this.queue = JSON.parse(decrypted);
    }
  });;
}

PersistentQueue.prototype._persist_queue = function () {
  if (this.write_encrypted) {
    this._persist_queue_encrypted()
  }
  else {
    this._persist_queue_plain()
  }
}

PersistentQueue.prototype._persist_queue_plain = function() {
  AsyncStorage.setItem(this.queue_name, JSON.stringify(this.queue),
    () => {
      is_dirty = false;
    },
    (error) => {
      console.log("Error while inserting data");
  });
}

PersistentQueue.prototype._persist_queue_encrypted = function() {
  var encrypted = this.encryptor.encrypt(JSON.stringify(this.queue))
  AsyncStorage.setItem(this.queue_name, encrypted,() => {
      is_dirty = false;
    },
    (error) => {
      console.log("Error while inserting data");
  });
}

PersistentQueue.prototype.check_if_command_queued = function(criteria) {
  for (var i = 0; i < this.queue.length; i++) {
    if(this.queue[i] && this.queue[i].commandId == criteria) {
      return true
    }
  }
  return false
}

PersistentQueue.prototype.should_send_command = function(command) {
  return this.should_retry_for_group(command.to)
}

exports.PersistentQueue = PersistentQueue;
