'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const _ = require('lodash');

admin.initializeApp(functions.config().firebase);

const database = admin.database();

//Initialize the game by assigning roles to the players
exports.initGame = functions.database.ref('/VillagesPlaying/{village}').onWrite(event => {

	//If event has changed, do nothing
  if (event.data.previous.exists()) {
    return;
  }

  //If event has removed, do nothing
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

    //If doesn't have roles or players, do nothing
    if(!results[0].hasChildren() || !results[1].hasChildren()){
      return;
    }
    
    //Take players id
    const playerArray =  _.keys(results[1].val());

    //Take all roles in array
    let rolesArray = [];

  	_.forEach(results[0].val(), function(value, key) {
  		const valInt = _.parseInt(value);
			
      //If value is greater than 1, add this rol as many times as value
      if( valInt > 1){
			  rolesArray = _.concat(rolesArray,Array(valInt).fill(key));
			}else{
			  rolesArray.push(key);
      }

		});

    //If number of players is different to number of roles, do nothing
		if(_.size(playerArray) != _.size(rolesArray)){
			return;
		}

    //Initialize player's roles randomly
  	const dict = _.zipObject(playerArray,_.shuffle(rolesArray));	
  		return database.ref('/VillagePlayer/'+village).set(dict);
  	});
      	
});

//Send a notification to the players with current role, wait 60 seconds, and change the turn.
exports.changeTurn = functions.database.ref('/PlayingTurn/{village}').onWrite(event => {

  //If doesn't have current turn, do nothing
  if (!event.data.exists()) {
    return;
  }

  //Get current player rol
  const rol = event.data.val();

  //Get village name
  const village = event.params.village;

  //Get promises from players and notification tokens in village 
  const getPlayers = database.ref('/VillagePlayer/'+village).once('value');
  const getTokens = database.ref('/VillageTokens/'+village).once('value');

  return Promise.all([getPlayers, getTokens]).then(results => {

      //If doesn't have players or tokens, do nothing
      if(!results[0].hasChildren() || !results[1].hasChildren()){
      	return;
      }

      //Get player's dictionary
      const players = results[0].val();

      //Get token's dictionary
      const villageTokens = results[1].val();

      //Save the tokens of the players who have the current game role.
      let tokens = []; 
      _.forEach(players,function(value,key){
      	if(_.isEqual(value,rol)){
      		const token = villageTokens[key];
      		if(token){
      			tokens.push(token);
      		}
      	}	
      });

      //Initialize the notification payload
      const payload = {
	      notification: {
	        title: 'Tu turno!',
	        body: 'Te toca jugar '+rol
	      }
    	};

      //Send a notification to all players with current role
    	return admin.messaging().sendToDevice(tokens, payload).then(response => {

        //Wait 60 econds
    		setTimeout(() => {

		      database.ref('/VillageTurns/'+village).once('value').then(function(snapshot){

            //Get the turns of the village
		      	const turns = _.values(snapshot.val());

            //If doesn't have turns, do nothing
		      	if(!turns){
		      		return;
		      	}

            //Check the current turn and get the index if it exist
		      	let index = _.indexOf(turns, rol);

		      	if(index > -1){

              //Check the next role and get it if exist
		      		let nextRol = turns[index + 1];
		      		if(nextRol != null){
                //Change to the next role
		      			return database.ref('/PlayingTurn/'+village).set(nextRol);
		      		}
		      	}
		      	return;
		      });
	      }, 60000);
    	});
    });
});
