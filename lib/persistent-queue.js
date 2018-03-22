import {InteractionManager, Text} from 'react-native';
import {AsyncStorage, Alert} from 'react-native';


PersistentQueue = function(name) {
  if(!name) {
    throw 'Queue name required';
  }
  this.queue_name = name;
  AsyncStorage.getItem(this.queue_name).then((data) => {
    if(data) {
      this.queue = JSON.parse(data);
    }
  });
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

PersistentQueue.prototype._persist_queue = function() {
  // var that = this;
  // AsyncStorage.setItem(that.queue_name, JSON.stringify(that.queue),
  //   () => {
  //     is_dirty = false;
  //   },
  //   (error) => {
  //     console.log("Error while inserting data");
  //   });
} 

PersistentQueue.prototype.check_if_command_queued = function(criteria) {
  for (var i = this.queue.length - 1; i >= 0; i--) {
    if(this.queue[i].command.check_if_command_already_exist(criteria)) {
      return true
    }    
  }
  return false
}

PersistentQueue.prototype.should_send_command = function(command) {
  return this.should_retry_for_group(command.to)
}

exports.PersistentQueue = PersistentQueue;