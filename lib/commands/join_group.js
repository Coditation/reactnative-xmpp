import Command from './command'

export default class JoinGroup extends Command {
	constructor(room, nick) {
		super();
		this.room = room;
		this.nick = nick;
	}
}