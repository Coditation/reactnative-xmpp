import Command from './command'

export default class JoinGroup extends Command {
	constructor(room, nick, stanza) {
		super();
		this.room = room;
		this.nick = nick;
		this.stanza = stanza
	}
}