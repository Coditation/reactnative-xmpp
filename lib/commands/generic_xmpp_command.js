import Command from './command'

export default class GenericXmppCommand extends Command {
	constructor(payload) {
		super();
		this.payload = payload;
	}
}