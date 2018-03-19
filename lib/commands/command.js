const CommandStatus = {
	QUEUED: 'QUEUED',
	COMPLETED: 'COMPLETED'
}

export default class Command {
	constructor() {
		this.status = CommandStatus.QUEUED;
	}
}

export {CommandStatus}
