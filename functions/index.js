'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const _ = require('lodash');

admin.initializeApp(functions.config().firebase);

const database = admin.database();

//Initialize Game
exports.initGame = functions.database.ref('/VillagesPlaying/{village}').onWrite(event => {

	//If event has changed, do not nothing
    if (event.data.previous.exists()) {
        return;
    }

    //If event has removed, do not nothing
    if (!event.data.exists()) {
        return;
    }

    //Get village name
    const village = event.params.village;

    //Remove village from free
    database.ref('/VillagesFree/'+village).remove();

    //Get promises from roles and players in village 
	const getRoles = database.ref('/VillageRoles/'+village).once('value');
    const getPlayers = database.ref('/VillagePlayer/'+village).once('value');

    return Promise.all([getRoles, getPlayers]).then(results => {

    	//If don't have roles or players, do not nothing
      	if(!results[0].hasChildren() || !results[1].hasChildren()){
      		return;
      	}

		const playerArray =  _.keys(results[1].val());
  		let rolesArray = [];

  		_.forEach(results[0].val(), function(value, key) {
  			const valInt = _.parseInt(value);
			if( valInt > 1){
			  	rolesArray = _.concat(rolesArray,Array(valInt).fill(key));
			}else{
			  	rolesArray.push(key);
			}
		});

		if(_.size(playerArray) != _.size(rolesArray)){
			return;
		}

  		const dict = _.zipObject(playerArray,_.shuffle(rolesArray));	
  		return database.ref('/VillagePlayer/'+village).set(dict);
  	});
      	
});

exports.changeTurn = functions.database.ref('/PlayingTurn/{village}').onWrite(event => {

    if (!event.data.exists()) {
        return;
    }

    const rol = event.data.val();
    const village = event.params.village;

    const getPlayers = database.ref('/VillagePlayer/'+village).once('value');
    const getTokens = database.ref('/VillageTokens/'+village).once('value');

    return Promise.all([getPlayers, getTokens]).then(results => {

      	if(!results[0].hasChildren() || !results[1].hasChildren()){
      		return;
      	}

      	const players = results[0].val();
      	const villageTokens = results[1].val();

      	let tokens = []; 
      	_.forEach(players,function(value,key){
      		if(_.isEqual(value,rol)){
      			const token = villageTokens[key];
      			if(token){
      				tokens.push(token);
      			}
      		}	
      	});

      	const payload = {
	      notification: {
	        title: 'Tu turno!',
	        body: 'Te toca jugar '+rol
	      }
    	};

    	return admin.messaging().sendToDevice(tokens, payload).then(response => {

    		setTimeout(() => {
		      	database.ref('/VillageTurns/'+village).once('value').then(function(snapshot){

		      	const turns = _.values(snapshot.val());

		      	if(!turns){
		      		return;
		      	}

		      	let index = _.indexOf(turns, rol);

		      	if(index > -1){
		      		let nextRol = turns[index + 1];
		      		if(nextRol != null){
		      			return database.ref('/PlayingTurn/'+village).set(nextRol);
		      		}
		      	}
		      	return;
		      });
	      	}, 30000);
    	});
    });
});
