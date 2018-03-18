const CommandStatus = {
	QUEUED: 'QUEUED',
	COMPLETED: 'COMPLETED'
}

class Command {
	constructor() {
		this.status = CommandStatus.QUEUED;
	}
}

module.exports = Command;