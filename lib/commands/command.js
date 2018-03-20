var uuidv5 = require('uuid/v5')
const CommandStatus = {
	QUEUED: 'QUEUED',
	COMPLETED: 'COMPLETED'
}

export default class Command {
	constructor() {
		this.status = CommandStatus.QUEUED;
		this.uuid = uuidv5((new Date).getTime() + "", uuidv5("SUNRISEHEALTH.CO", uuidv5.DNS))
	}	
}

export {CommandStatus}
