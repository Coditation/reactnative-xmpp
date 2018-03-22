import Command from './command'

export default class JoinGroup extends Command {
	constructor(room, nick, stanza) {
		super();
		this.room = room;
		this.nick = nick;
		this.stanza = stanza
	}

	check_if_command_already_exist(criteria) {
		if(this.room == criteria) {
			return true
		}
		return false
	}
}