'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const _ = require('lodash');

admin.initializeApp(functions.config().firebase);

const database = admin.database();

//Initialize the game by assigning roles to the players
exports.initGame = functions.database.ref('/VillagesPlaying/{village}').onWrite(event => {

	//If event has been changed, do nothing
	if (event.data.previous.exists()) {
		return;
	}

  //If event has been removed, do nothing
  if (!event.data.exists()) {
  	return;
  }

  //Get village name
  const village = event.params.village;

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

    _.forEach(results[0].val(), (value, key) => {
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


    //Remove village from free and set player roles
    var updates = {};
    updates['/VillagesFree/'+village] = null;
    updates['/VillagePlayer/'+village] = dict;

    return database.ref().update(updates);
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
      _.forEach(players,(value,key) => {
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

      sendNotifications(tokens,payload,() => {
      	//Wait 60 seconds
        setTimeout(() => {
        	doMovements(tokens);
        	database.ref('/VillageTurns/'+village).once('value').then( snapshot => {

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

exports.checkPlayerStatus = functions.database.ref('/VillagePlayer/{village}/{playerId}').onWrite(event => {

	//If event has been removed, do nothing
	if (!event.data.exists()) {
		return;
	}

  //If event hasn't been changed, do nothing
  if (!event.data.previous.exists()) {
  	return;
  }

  

  const village = event.params.village;
  const playerId = event.params.playerId;

  return database.ref('/User/'+playerId).child('notificationToken').once('value').then(function(response){

    const token = response.val()
    const values = event.data.val();
    const arrayValues = _.split(values,":");
    const lastStatus = _.last(arrayValues);

    console.log("TOKEN: "+token);
    console.log("IGI: "+response);

    const status = _.split(lastStatus,"-");

    let statusTitle = ""
    let statusBody = ""

    switch(status[0]){
      case "DEATH":
      console.log("IS DEATH")
      statusTitle = "¡Estás muerto!"

      if(status[1] == 'VILLAGE'){
        statusBody = "El pueblo ha decidido que debes morir"
      }else if(status[1] == 'WITCH'){
        statusBody = "La bruja ha decidido que debes morir"
      }else{
        statusBody = "Los lobos han decidido que debes morir"
      }

      break;
      case "MAYOR":
      console.log("IS MAYOR")
      statusTitle = "¡Eres Alcalde!"

      if(status[1] == 'VILLAGE'){
        statusBody = "¡Enhorabuena!, el pueblo te ha elegido como su representante"
      }else{
        statusBody = "¡Enhorabuena!, el anterior alcalde en su último aliento te ha cedido el puesto"
      }

      break;
      case "LOVED":
      console.log("IS LOVED")
      statusTitle =  '¡Estás enamorado!';
      statusBody = 'Tu enamorado es '+status[1];
      break;
    }

    if(_.size(statusTitle) > 0 && _.size(statusBody) > 0){

      const payload = {
        notification: {
          title: statusTitle,
          body: statusBody
        }
      }

      console.log("Title: "+statusTitle)
      console.log("Body: "+statusBody)
      console.log("Payload: "+payload)

      sendNotifications([token],payload,() => {})
      return;
    }
  });
});

exports.deleteVillage = functions.database.ref('/Villages/{village}').onWrite(event => {

  //If is a new event, do nothing
  if (!event.data.previous.exists()) {
  	return;
  }

  //Get village name
  const village = event.data.previous.key;

  if(!event.data.exists()){

    //If village has been removed, remove all entries
    var updates = {};
    updates['/PlayingTurn/'+village] = null;
    updates['/VillagePlayer/'+village] = null;
    updates['/VillageRoles/'+village] = null;
    updates['/VillageTurns/'+village] = null;
    updates['/VillagesPlaying/'+village] = null;
    updates['/VillagesFree/'+village] = null;
    updates['/VillageTokens/'+village] = null;
    updates['/PlayerVote/'+village] = null;
    return database.ref().update(updates);
  }
  return;
});

function doMovements(tokens){

	const payload = {
   notification: {
     title: 'Se te acabó el turno!'
   }
 };

 sendNotifications(tokens,payload);

}

function sendNotifications(tokens,payload,callback){
	admin.messaging().sendToDevice(tokens, payload).then(response => {
		callback();
	});
}
