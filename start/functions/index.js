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
  Suggestions,
} = require('actions-on-google');
const functions = require('firebase-functions');
// Load schedule from JSON file
const schedule = require('./schedule.json');

// Suggestion chip titles
const Suggestion = {
  HOURS: 'Ask about hours',
  CLASSES: 'Learn about classes',
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

// Dialogflow app instance
const app = dialogflow({debug: true});

/*
 * Fallback counting that runs before every intent handler.
 * Will reset the fallback count to 0 if the intent
 * is anything other than the fallback intent.
 */
app.middleware((conv) => {
  if (!conv.data.fallbackCount || !(conv.intent === 'Fallback')) {
    conv.data.fallbackCount = 0;
  }
});

// Welcome intent handler
app.intent('Welcome', (conv) => {
  const welcomeMessage = 'Welcome to Action Gym, your local gym here to ' +
    'support your health goals. You can ask me about our hours ' +
    'or what classes we offer each day.';
  conv.ask(welcomeMessage);
  if (conv.screen) {
    conv.ask(new Suggestions([Suggestion.HOURS, Suggestion.CLASSES]));
  }
});

// Quit intent handler
app.intent('Quit', (conv) => {
  conv.close('Great chatting with you!');
});

// Hours intent handler
app.intent('Hours', (conv) => {
  const hoursMessage = 'Our free weights and machines are available ' +
    'from 5am - 10pm, seven days a week. Can I help you with anything else?';
  conv.ask(hoursMessage);
  if (conv.screen) {
    conv.ask(new Suggestions([Suggestion.CLASSES]));
  }
});

// Class List intent handler
app.intent('Class List', (conv, {day}) => {
  if (!day) {
    day = DAYS[new Date().getDay()];
  }
  const classes =
    [...new Set(schedule.days[day].map((d) => `${d.name} at ${d.startTime}`))]
    .join(', ');
  const classesMessage =
    `On ${day} we offer the following classes: ${classes}. ` +
    `Can I help you with anything else?`;
  conv.ask(classesMessage);
  if (conv.screen) {
    conv.ask(new Suggestions([Suggestion.HOURS]));
  }
});

// No Input intent handler
app.intent('No Input', (conv) => {
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
app.intent('Fallback', (conv) => {
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

exports.fulfillment = functions.https.onRequest(app);
