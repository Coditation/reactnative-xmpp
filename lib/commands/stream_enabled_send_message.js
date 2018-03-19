var Command = require('./command.js');

const StreamEnabledSendMessageCommandStatus = {
	SENT: "SENT",
	ACK_PENDING: "ACK_PENDING",
	ACK_RECEIVED: "ACK_RECEIVED"
}

class StreamEnabledSendMessage extends Command {
	constructor(message) {
		super();
		this.message = message;
	}
}