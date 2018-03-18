var Command = require('./command.js');

class JoinGroup extends Command {
	constructor(room, nick) {
		super();
		this.room = room;
		this.nick = nick;
	}
}