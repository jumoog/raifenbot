const { Client, RichEmbed } = require("discord.js");
const client = new Client();
const config = require("./config.json");
const p = require('phin').promisified;
const TwitchWebhook = require('twitch-webhook');
const loki = require('lokijs');
const userDb = new loki('loki.json');
const _ = require("underscore");
const os = require('os');
const uuidv4 = require('uuid/v4');
const download = require('image-downloader')

let output = [];

let spamchannel;
let streamchannel;
let announcementschannel;

const twitchWebhook = new TwitchWebhook({
    client_id: config.Client_ID,
    callback: config.callback,
    secret: config.secret,
    listen: {
        port: config.port,
        host: config.host,
        autoStart: true
    }
});

client.on("ready", () => {
    announcementschannel = client.channels.find('name', "announcements");
    spamchannel = client.channels.find('name', config.trash_room);
    streamchannel = client.channels.find('name', config.target_room);
    if (config.debugMode) {
        spamchannel.send("I am so 🧀");
    }
    client.user.setActivity(`Serving ${client.users.size} members!`);
    userDb.loadDatabase({}, function () {
        subscibeAll();
    });
});

client.on("guildMemberAdd", (member) => {
    client.user.setActivity(`Serving ${client.users.size} members!`);
});

client.on("guildMemberRemove", (member) => {
    client.user.setActivity(`Serving ${client.users.size} members!`);
});

client.on("message", async message => {
    // ignore bots and commands without prefix
    if (!message.content.startsWith(config.prefix) || message.author.bot) return;

    // get args as array
    const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
    // extract command
    const command = args.shift().toLowerCase();

    if (command === "stats") {
        if (!message.member.roles.some(r => ["Modz", "Admin"].includes(r.name))) {
            return message.reply("Sorry, you don't have permissions to use this!");
        }

        const embed = new RichEmbed()
            // Set the title of the field
            .setTitle("Server Infos:")
            // Set the color of the embed
            .setColor(0x51e506)
            .addField("Uptime", format(os.uptime()))
            .addField("Cpu platform", os.arch())
            .addField("Cpu model", os.cpus()[0].model)
            .addField("Cpu cores", os.cpus().length)
            .addField("Total memory (mb)", os.totalmem() / (1024 * 1024))
            .addField("Free memory (mb)", os.freemem() / (1024 * 1024))
            .addField("Load", os.loadavg())
            .addField("OS", os.platform())
            .addField("Version", os.release());
        spamchannel.send(embed);
    }

    if (command === "ping") {
        if (!message.member.roles.some(r => ["Modz", "Admin"].includes(r.name))) {
            return message.reply("Sorry, you don't have permissions to use this!");
        }
        // Calculates ping between sending a message and editing it, giving a nice round-trip latency.
        // The second ping is an average latency between the bot and the websocket server (one-way, not round-trip)
        const m = await message.channel.send("Ping?");
        m.edit(`Pong! Latency is ${m.createdTimestamp - message.createdTimestamp}ms. API Latency is ${Math.round(client.ping)}ms`);
    }

    if (command === "catfact") {
        getNewCatFact().then(function (catFact) {
            return message.reply(catFact);
        });
    }

    if (command === "purge") {
        if (!message.member.roles.some(r => ["Modz", "Admin"].includes(r.name))) {
            return message.reply("Sorry, you don't have permissions to use this!");
        }
        // This command removes all messages from all users in the channel, up to 100.

        // get the delete count, as an actual number.
        const deleteCount = parseInt(args[0], 10);

        // Ooooh nice, combined conditions. <3
        if (!deleteCount || deleteCount < 2 || deleteCount > 100)
            return message.reply("Please provide a number between 2 and 100 for the number of messages to delete");

        // So we get our messages, and delete them. Simple enough, right?
        const fetched = await message.channel.fetchMessages({ limit: deleteCount });
        message.channel.bulkDelete(fetched)
            .catch(error => message.reply(`Couldn't delete messages because of: ${error}`));
    }

    // trigger for !add in allowed room
    if (command === "add" && message.channel.id === config.allowed_room) {
        if (!message.member.roles.some(r => ["Modz", "Admin"].includes(r.name))) {
            return message.reply("Sorry, you don't have permissions to use this!");
        }
        // check if we have enough args
        if (args.length != 2) {
            message.reply('incomplete argument: \n please use !add <@username> <twitch name>');
            return;
        }
        // returns all member with target role
        let membersWithRole = message.guild.members.filter(member => {
            return member.roles.get(config.role);
        }).map(member => {
            return member.user.id;
        });
        // remmove discord crap from userid
        args[0] = args[0].match(/[^a-z!@ ]\ *([.0-9])*\d/)[0];
        // check if given user is part of STREAMER FRIENDS
        if (membersWithRole.includes(args[0])) {
            getStreamInfos(args[1]).then(function (result) {
                if (_.isEmpty(result)) {
                    spamchannel.send(`<${args[1]}> is no valid Twitch User!`);
                    return;
                }
                const embed = new RichEmbed()
                    // Set the title of the field
                    .setTitle(result.display_name)
                    // Set the color of the embed
                    .setColor(0x4b367c)
                    // Set the main content of the embed
                    .setDescription(result.description)
                    .setThumbnail(result.profile_image_url)
                    .setURL("https://www.twitch.tv/" + result.login)
                    .addField("view count", result.view_count);
                var userID = userDb.getCollection('users').find({ twitch_id: result.id });
                // if user isn't in the DB
                if (_.isEmpty(userID)) {
                    // add user to DB
                    userDb.getCollection('users').insert({ twitch_id: result.id, discord_id: args[0] });
                    // save DB
                    userDb.saveDatabase();
                    // send message to room
                    spamchannel.send("added:");
                    spamchannel.send(embed);
                    // subcribe Twitch webhook
                    subscribeTwitchLiveWebhook(result.id);

                }
                else {
                    spamchannel.send(`<@${args[0]}> is already in Database!`);
                }
            });

        }
        else {
            message.reply(`<@${args[0]}> is not part of of STREAMER FRIENDS, please add <@${args[0]}> to STREAMER FRIENDS first!`);
        }
    }
});

// someones role has changed
client.on('guildMemberUpdate', (oldMember, newMember) => {
    // user is no longer in role
    if (!newMember.roles.has(config.role) && oldMember.roles.has(config.role)) {
        // check if user was in our DB
        let twitchID = userDb.getCollection('users').find({ discord_id: newMember.id });
        // if user was in our DB
        if (!_.isEmpty(twitchID)) {
            // remove the user
            userDb.getCollection('users').findAndRemove({ discord_id: newMember.id });
            // save the DB
            userDb.saveDatabase();
            // unsubcribe Twitch webhook
            unsubscribeTwitchLiveWebhook(twitchID[0].twitch_id);
        }
        spamchannel.send(`${newMember} is no longer part of STREAMER FRIENDS`);
    }
    if (newMember.roles.has(config.role) && !oldMember.roles.has(config.role)) {
        spamchannel.send(`${newMember} is part of STREAMER FRIENDS now`);
    }
});

client.login(config.token);

twitchWebhook.on('streams', ({ topic, options, endpoint, event }) => {
    if (event.data.length != 0) {
        if (!isOnlineInDB(event.data[0].user_id)) {
            // get current twitch name from twitch
            getTwitchUserByID(event.data[0].user_id).then(function (resultUser) {
                // get game name from twitch
                getTwitchGameByID(event.data[0].game_id).then(function (resultGame) {
                    sendDiscordEmbed(event, resultUser, resultGame);
                });
            });
        }
    }
    else {
        if (isOnlineInDB(options.user_id)) {
            output.splice(_.findIndex(output, { twitch_id: options.user_id }), 1);
            if (config.offlineMessage) {
                var userID = userDb.getCollection('users').find({ twitch_id: options.user_id });
                streamchannel.send(`<@${userID[0].discord_id}> is offline now`);
            }
        }
    }
});

twitchWebhook.on('unsubscibe', (obj) => {
    twitchWebhook.subscribe(obj['hub.topic'])
});

function subscribeTwitchLiveWebhook(id) {
    twitchWebhook.subscribe('streams', {
        user_id: id
    });
}

function unsubscribeTwitchLiveWebhook(id) {
    twitchWebhook.unsubscribe('streams', {
        user_id: id
    });
}

function sendDiscordEmbed(event, user, game) {
    let filename = uuidv4() + ".jpg";
    downloadIMG(`https://static-cdn.jtvnw.net/previews-ttv/live_user_${user}-1280x720.jpg`, filename).then(function (resultPath) {
        let userID = userDb.getCollection('users').find({ twitch_id: event.data[0].user_id });
        let rightNow = new Date();
        let x = rightNow.toISOString();
        let embed = new RichEmbed()
            .setColor("#9B59B6")
            .attachFile(resultPath)
            .setDescription(`**Playing**: ${game}`)
            .setTitle(event.data[0].title)
            .setURL(`https://twitch.tv/${user}`)
            .setImage(`attachment://${filename}`)
            .setTimestamp(x);
        if (event.data[0].user_id === "71946143") {
            announcementschannel.send(`@everyone <@${userID[0].discord_id}> is live now`);
            announcementschannel.send(embed);
        }
        else {
            streamchannel.send(`<@${userID[0].discord_id}> is live now`);
            streamchannel.send(embed);
        }
    });
}

async function getTwitchUserByID(id) {
    // build the URL
    let url = `https://api.twitch.tv/helix/users?id=${id}`;
    // do the request
    let res = await p({
        url: url,
        parse: 'json',
        headers: {
            'Client-ID': config.Client_ID
        }
    });
    return res.body.data[0].display_name;
}

async function getTwitchGameByID(id) {
    // some people maybe have GameID 0 which is not valid somehow
    if (id === "0") {
        id = "1";
    }
    // build the URL
    let url = `https://api.twitch.tv/helix/games?id=${id}`;
    // do the request
    let res = await p({
        url: url,
        parse: 'json',
        headers: {
            'Client-ID': config.Client_ID
        }
    });
    return res.body.data[0].name;
}

async function getStreamInfos(streamer) {
    // build the URL
    let url = `https://api.twitch.tv/helix/users?login=${streamer}`;
    // do the request
    let res = await p({
        url: url,
        parse: 'json',
        headers: {
            'Client-ID': config.Client_ID
        }
    });
    return res.body.data[0];
}

function getAllUsers() {
    return userDb.getCollection('users').find();
};

function subscibeAll() {
    var a = getAllUsers();
    //spamchannel.send("Database loaded! ☁");
    for (var i = 0; i < a.length; i++) {
        subscribeTwitchLiveWebhook(a[i].twitch_id);
        if (config.debugMode) {
            getTwitchUserByID(a[i].twitch_id).then(function (resultUser) {
                spamchannel.send(`loaded: <${resultUser}> ✅`);
            });
        }
    }
}

// tell Twitch that we no longer listen
// otherwise it will try to send events to a down app
process.on('SIGINT', () => {
    // unsubscribe from all topics
    twitchWebhook.unsubscribe('*');
    process.exit(0);
});

function format(time) {
    let days = Math.floor(time % 31536000 / 86400)
    let hours = Math.floor(time % 31536000 % 86400 / 3600)
    let minutes = Math.floor(time % 31536000 % 86400 % 3600 / 60)
    let seconds = Math.round(time % 31536000 % 86400 % 3600 % 60)
    days = days > 9 ? days : '0' + days
    hours = hours > 9 ? hours : '0' + hours
    minutes = minutes > 9 ? minutes : '0' + minutes
    seconds = seconds > 9 ? seconds : '0' + seconds
    return `${days > 0 ? `${days}:` : ``}${(hours || days) > 0 ? `${hours}:` : ``}${minutes}:${seconds}`
}

function isOnlineInDB(twitch_id) {
    if (_.findIndex(output, { twitch_id: twitch_id }) === -1) {
        output.push({ 'twitch_id': twitch_id });
        return false;
    }
    return true;
}

function isOnline(twitch_id) {
    getStreamState(twitch_id).then(function (resultUser) {
        if (_.isEmpty(resultUser)) {
            return true;
        }
        return false;
    });
}

async function getStreamState(id) {
    // build the URL
    let url = `https://api.twitch.tv/helix/streams?user_id=${id}`;
    // do the request
    let res = await p({
        url: url,
        parse: 'json',
        headers: {
            'Client-ID': config.Client_ID
        }
    });
    return res.body.data;
}

async function getNewCatFact() {
    // build the URL
    let url = `https://catfact.ninja/fact`;
    // do the request
    let res = await p({
        url: url,
        parse: 'json'
    });
    return res.body.fact;
}

async function downloadIMG(url, target_filename) {
    const options = {
        url: url,
        dest: '/tmp/' + target_filename
    }
    try {
        const { filename, image } = await download.image(options)
        return (filename) // => /path/to/dest/image.jpg 
    } catch (e) {
        console.error(e)
    }
}
