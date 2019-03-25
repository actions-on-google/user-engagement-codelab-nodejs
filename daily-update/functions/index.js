// Copyright 2019, Google, Inc.
// Licensed under the Apache License, Version 2.0 (the 'License');
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an 'AS IS' BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict';

const {
  dialogflow,
  RegisterUpdate,
  Suggestions,
  UpdatePermission,
} = require('actions-on-google');
const request = require('request');
const {auth} = require('google-auth-library');
const functions = require('firebase-functions');
// Load schedule from JSON file
const schedule = require('./schedule.json');
const admin = require('firebase-admin');

// Firestore constants
const FirestoreNames = {
  INTENT: 'intent',
  USER_ID: 'userId',
  USERS: 'users',
};

// Suggestion chip titles
const Suggestion = {
  HOURS: 'Ask about hours',
  CLASSES: 'Learn about classes',
  REMINDER: 'Set reminders',
  CANCELLATION: 'Class cancellation',
  DAILY_UPDATE: 'Send daily updates',
  ROUTINES: 'Set up routines',
  NOTIFICATION: 'Send notifications',
  YES: 'Sure!',
  NO: 'No thanks',
};

// Days of the week
const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

// Initialize Firestore
admin.initializeApp();
const db = admin.firestore();

// Dialogflow app instance
const app = dialogflow({debug: true});

/*
 * Middleware that runs before every intent handler.
 * Will reset the fallback count to 0 if the intent
 * is anything other than the fallback intent.
 */
app.middleware((conv) => {
  if (!conv.data.fallbackCount || !(conv.intent === 'fallback')) {
    conv.data.fallbackCount = 0;
  }
});

// Welcome intent handler
app.intent('welcome', (conv) => {
  const welcomeMessage = 'Welcome to Action Gym, your local gym here to ' +
    'support your health goals. You can ask me about our hours ' +
    'or what classes we offer each day.';
  conv.ask(welcomeMessage);
  if (conv.screen) {
    conv.ask(new Suggestions([Suggestion.HOURS, Suggestion.CLASSES,
      Suggestion.CANCELLATION]));
  }
});

// Quit intent handler
app.intent('quit', (conv) => {
  conv.close('Great chatting with you!');
});

// Hours intent handler
app.intent('hours', (conv) => {
  const hoursMessage = 'Our free weights and machines are available ' +
    'from 5am - 10pm, seven days a week. Can I help you with anything else?';
  conv.ask(hoursMessage);
  if (conv.screen) {
    conv.ask(new Suggestions([Suggestion.CLASSES]));
  }
});

// Class list intent handler
app.intent('classList', (conv, {day}) => {
  if (!day) {
    day = DAYS[new Date().getDay()];
  }
  const classes =
    [...new Set(schedule.days[day].map((d) => `${d.name} at ${d.startTime}`))]
    .join(', ');
  const classesMessage =
    `On ${day} we offer the following classes: ${classes}. ` +
    `If you'd like, I can send you reminders about our classes. ` +
    `Can I help you with anything else?`;
  conv.ask(classesMessage);
  if (conv.screen) {
    conv.ask(new Suggestions([Suggestion.HOURS, Suggestion.REMINDER,
      Suggestion.CANCELLATION]));
  }
});

// No-input intent handler
app.intent('noInput', (conv) => {
  const repromptCount = parseInt(conv.arguments.get('REPROMPT_COUNT'));
  if (repromptCount === 0) {
    conv.ask('Sorry, I can\'t hear you.');
  } else if (repromptCount === 1) {
    conv.ask('I\'m sorry, I still can\'t hear you.');
  } else if (conv.arguments.get('IS_FINAL_REPROMPT')) {
    conv.close('I\'m sorry, I\'m having trouble here. ' +
      'Maybe we should try this again later.');
  }
});

// Fallback intent handler
app.intent('fallback', (conv) => {
  conv.data.fallbackCount++;
  if (conv.data.fallbackCount === 1) {
    conv.ask('Sorry, what was that?');
  } else if (conv.data.fallbackCount === 2) {
    conv.ask('I didn\'t quite get that. I can tell you our hours ' +
      'or what classes we offer each day.');
  } else {
    conv.close('Sorry, I\'m still having trouble. ' +
      'So let\'s stop here for now. Bye.');
  }
 });

// Reminders intent handler
// The prompt and suggestion chips for this intent should
// be updated for Routines when testing Routine flow.
app.intent('reminder', (conv) => {
  const reminderMessage = 'Great! I can send you the list of classes by ' +
    'sending you a daily updates. Let me know if you want me to send these ' +
    'to you.';
  conv.ask(reminderMessage);
  if (conv.screen) {
    conv.ask(new Suggestions([Suggestion.DAILY_UPDATE]));
  }
});

// Notifications intent handler
app.intent('notification', (conv) => {
  const moreOptionsMessage = 'I can support you by sending you ' +
    'notifications when classes get cancelled due to emergencies. ' +
    'Let me know if you want me to send these to you.';
  conv.ask(moreOptionsMessage);
  if (conv.screen) {
    conv.ask(new Suggestions([Suggestion.NOTIFICATION]));
  }
});

app.intent('setupPushNotifications', (conv) => {
  conv.ask('Update permission for setting up push notifications');
  conv.ask(new UpdatePermission({intent: 'classCanceled'}));
});

// Start opt-in flow for push notifications
app.intent('configurePushNotifications', (conv) => {
  if (conv.arguments.get('PERMISSION')) {
    let userId = conv.arguments.get('UPDATES_USER_ID');
    if (!userId) {
      userId = conv.request.conversation.conversationId;
    }
    return db.collection(FirestoreNames.USERS)
    .add({
      [FirestoreNames.INTENT]: 'classCanceled',
      [FirestoreNames.USER_ID]: userId,
    })
    .then(() => {
      conv.ask('Cool, I\'ll notify you whenever there is a cancelation. ' +
        'Would you like anything else?');
    });
  } else {
    conv.ask('Okay, I won\'t notify you. Would you like anything else?');
  }
});

// Intent to be triggered when tapping push notification
app.intent('classCanceled', (conv) => {
  conv.ask('A class was canceled.');
});

// Start opt-in flow for daily updates
app.intent('setupUpdates', (conv) => {
  conv.ask(new RegisterUpdate({
    intent: 'classList',
    frequency: 'DAILY',
  }));
});

// Confirm outcome of opt-in for daily updates.
app.intent('configureUpdates', (conv, params, registered) => {
  if (registered && registered.status === 'OK') {
    conv.ask('Gotcha, I\'ll send you an update everyday with the ' +
      'list of classes. Anything else I can help you with?');
  } else {
    conv.ask('Ok, I won\'t send you daily updates. Anything else I ' +
      'can help you with?');
  }
  if (conv.screen) {
    conv.ask(new Suggestions([Suggestion.HOURS, Suggestion.CLASSES,
      Suggestion.REMINDER, Suggestion.CANCELLATION]));
  }
});

// Start opt-in flow for routines
app.intent('setupRoutine', (conv) => {
  conv.ask(new RegisterUpdate({
    intent: 'classList',
    frequency: 'ROUTINES',
  }));
});

// Confirm outcome of opt-in for routines.
app.intent('configureRoutine', (conv) => {
  conv.ask('Anything else I can help you with?');
  if (conv.screen) {
    conv.ask(new Suggestions([Suggestion.HOURS, Suggestion.CLASSES,
      Suggestion.REMINDER, Suggestion.NOTIFICATION]));
  }
});

// Cancel class intent to trigger a push notification from
// the Action conversation itself.
app.intent('cancelClass', (conv) => {
  let client = auth.fromJSON(require('./service-account.json'));
  client.scopes = ['https://www.googleapis.com/auth/actions.fulfillment.conversation'];
  let notification = {
    userNotification: {
      title: 'Notification Title',
    },
    target: {},
  };
  client.authorize((err, tokens) => {
    if (err) {
      throw new Error(`Auth error: ${err}`);
    }
    db.collection(FirestoreNames.USERS)
        .where(FirestoreNames.INTENT, '==', 'classCanceled')
        .get()
        .then((querySnapshot) => {
          querySnapshot.forEach((user) => {
            notification.target = {
              userId: user.get(FirestoreNames.USER_ID),
              intent: user.get(FirestoreNames.INTENT),
            };
            request.post('https://actions.googleapis.com/v2/conversations:send', {
              'auth': {
                'bearer': tokens.access_token,
              },
              'json': true,
              'body': {'customPushMessage': notification, 'isInSandbox': true},
            }, (err, httpResponse, body) => {
              if (err) {
                throw new Error(`API request error: ${err}`);
              }
              console.log(`${httpResponse.statusCode}: ` +
                `${httpResponse.statusMessage}`);
              console.log(JSON.stringify(body));
            });
          });
        })
        .catch((error) => {
          throw new Error(`Firestore query error: ${error}`);
        });
  });
  conv.ask('A notification has been sent to all subscribed users.');
});

exports.fulfillment = functions.https.onRequest(app);
