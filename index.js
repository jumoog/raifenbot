const { Client, RichEmbed } = require("discord.js");
const client = new Client();
const config = require("./config.json");
const p = require('phin').promisified;
const TwitchWebhook = require('twitch-webhook');
const loki = require('lokijs');
const userDb = new loki('loki.json');
const _ = require("underscore");

let spamchannel;
let streamchannel;

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
    spamchannel = client.channels.find('name', config.trash_room);
    streamchannel = client.channels.find('name', config.target_room);
    spamchannel.send("I am so 🧀");
    userDb.loadDatabase({}, function () {
        subscibeAll();
    });
});

client.on("message", (message) => {
    // ignore bots and commands without prefix
    if (!message.content.startsWith(config.prefix) || message.author.bot) return;

    // get args as array
    const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
    // extract command
    const command = args.shift().toLowerCase();

    // trigger for !add in allowed room
    if (command === "add" && message.channel.id === config.allowed_room) {
        // check if we have enough args
        if (args.length != 2) {
            message.reply('incomplete argument: \n please use !add <@username> <twitch name>');
            return;
        }
        // returns all member with target role
        let membersWithRole =  message.guild.members.filter(member => {
            return member.roles.get(config.role);
        }).map(member => {
            return member.user.id;
        });
        // remmove discord crap from userid
        args[0] = args[0].match(/[^a-z!@ ]\ *([.0-9])*\d/)[0];
        // check if given user is part of STREAMER FRIENDS
        if (membersWithRole.includes(args[0])) {
            getStreamInfos(args[1]).then(function (result) {
                if (_.isEmpty(result))
                {
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
            message.reply(`${args[0]} is not part of of STREAMER FRIENDS, please add ${args[0]} to STREAMER FRIENDS first!`);
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
        // get current twitch name from twitch
        getTwitchUserByID(event.data[0].user_id).then(function (resultUser) {
            // get game name from twitch
            getTwitchGameByID(event.data[0].game_id).then(function (resultGame) {
                sendDiscordEmbed(event, resultUser, resultGame);
            });
        });
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
    var userID = userDb.getCollection('users').find({ twitch_id: event.data[0].user_id });
    var rightNow = new Date();
    var x = rightNow.toISOString();
    let embed = new RichEmbed()
        .setColor("#9B59B6")
        .setDescription(`**Playing**: ${game}`)
        .setTitle(event.data[0].title)
        .setURL(`https://twitch.tv/${user}`)
        .setImage(event.data[0].thumbnail_url.replace("{width}", "400").replace(
            "{height}", "225"))
        .setTimestamp(x);

    streamchannel.send(`<@${userID[0].discord_id}> is live now`);
    streamchannel.send(embed);
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
    spamchannel.send("Database loaded! ☁");
    for (var i = 0; i < a.length; i++) {
        subscribeTwitchLiveWebhook(a[i].twitch_id);
        getTwitchUserByID(a[i].twitch_id).then(function (resultUser) {
            spamchannel.send(`loaded: <${resultUser}> ✅`);
        });
    }
}

// tell Twitch that we no longer listen
// otherwise it will try to send events to a down app
process.on('SIGINT', () => {
    // unsubscribe from all topics
    twitchWebhook.unsubscribe('*');
    process.exit(0);
});
