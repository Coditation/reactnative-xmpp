var Command = require('./command.js');

const StreamEnabledSendMessageCommandStatus = {
	SENT: "SENT",
	RETRYING: "RETRYING",
	ACK_RECEIVED: "ACK_RECEIVED"
}

class StreamEnabledSendMessage extends Command {
	constructor(message) {
		super();
		this.message = message;
	}
}