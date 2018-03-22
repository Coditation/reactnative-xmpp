import {InteractionManager, Text} from 'react-native';
import {AsyncStorage, Alert} from 'react-native';


AsyncStorageBackedQueue = function(config) {
    if('xmpp_client' in config) {
      this.xmpp_client = config.xmpp_client;
    }
    if('retry_interval_sec' in config) {
      this.retry_interval_sec = config.retry_interval_sec;
    }
    if('queue_name' in config) {
      this.queue_name = config.queue_name;
      AsyncStorage.getItem(this.queue_name).then((data) => {
        if(data) {
          this.queue = JSON.parse(data);
        }
      });
    } else {
      throw {
        "messgae": "Queue name missing"
      }
    }
}

AsyncStorageBackedQueue.prototype.queue = []
AsyncStorageBackedQueue.prototype.queue_name = undefined
AsyncStorageBackedQueue.prototype.is_dirty = false
AsyncStorageBackedQueue.prototype.retry_interval_sec = 15;
AsyncStorageBackedQueue.prototype.xmpp_client = undefined;
AsyncStorageBackedQueue.prototype.interval = undefined;
AsyncStorageBackedQueue.prototype.should_retry_for_group = undefined;


AsyncStorageBackedQueue.prototype.dequeue_element = function(id, id_field) {
  console.log(`***** dequeue ${id} : queue ${JSON.stringify(this.queue)}`)
  var elements = this.queue.map(function(el) {
    return el[id_field];
  })
  if(elements.length > 0) {
    var dequeued_element = this.queue.splice(this.queue.indexOf(elements[0]), 1);
    this._persist_queue();
    return dequeued_element[0];
  }
  return undefined;
}

AsyncStorageBackedQueue.prototype.queue_element = function(new_element) {
  var element = this.queue.filter((element) => {
    return element.id == new_element.id
  })
  if (element.length > 0) {
    return
  }
  this.queue.push(new_element);
  this.is_dirty = true;
  this._persist_queue();
}


AsyncStorageBackedQueue.prototype.dequeue = function () {
  var element = this.queue.pop();
  this._persist_queue();
  return element;
}

AsyncStorageBackedQueue.prototype.filter = function(filter_fn) {
  var res = this.queue.filter(filter_fn);
  if(res && res.length > 0) {
    return res[0];
  }
}

AsyncStorageBackedQueue.prototype._persist_queue = function() {
  var that = this;
  AsyncStorage.setItem(that.queue_name, JSON.stringify(that.queue),
    () => {
      is_dirty = false;
    },
    (error) => {
      console.log("Error while inserting data");
    });
}

AsyncStorageBackedQueue.prototype._retry_send = function() {
  this.interval = setInterval(() => {
    InteractionManager.runAfterInteractions(() => {
      this.queue.map((el) => {
        if((new Date().getTime() - el.send_timestamp) >= this.retry_interval_sec*1000) {
          if(this.xmpp_client && this.should_retry_for_group && this.should_retry_for_group(el.to)) {
            try {                
              this.xmpp_client.push(el.to, el.str, el.type, el.message, true);
            }
            catch(e) {
              
            }
          }
        }
      });
    });
  }, this.retry_interval_sec*1000);
}

AsyncStorageBackedQueue.prototype.stop_retry_send = function() {
  if (this.interval !== undefined) {
    clearInterval(this.interval)
  }
} 

AsyncStorageBackedQueue.prototype.start_retry = function() {
  this._retry_send();
}

exports.AsyncStorageBackedQueue = AsyncStorageBackedQueue;