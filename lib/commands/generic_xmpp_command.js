var Command = require('./command.js');

class StreamEnabledSendMessage extends Command {
	constructor(payload) {
		super();
		this.payload = payload;
	}
}