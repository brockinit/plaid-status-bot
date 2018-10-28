const fs = require('fs');
const path = require('path');
const request = require('request-promise-native');

let institutionStatuses = {
  uptime: {},
  timeline: [{}],
};
const PLAID_API = {
  STATUS_HOST: 'https://status.plaid.com',
  UPTIME_URL: '/institutions/uptime',
  TIMELINE_URL: '/issues/timeline',
};
const PROBLEM_STATUSES = ['warning', 'error'];
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const CHECK_STATUS_INTERVAL = process.env.CHECK_STATUS_INTERVAL || 60000;

async function checkPlaidStatus() {
  let uptimeData;
  let timelineData;
  try {
    uptimeData = JSON.parse(await request(`${PLAID_API.STATUS_HOST}${PLAID_API.UPTIME_URL}`));
    timelineData = JSON.parse(await request(`${PLAID_API.STATUS_HOST}${PLAID_API.TIMELINE_URL}`));
  } catch(err) {
    console.error(`Error getting plaid data: ${err.message}`);
  }
  const uptimeAlerts = getUptimeAlerts(uptimeData);
  const timelineAlerts = getTimelineAlerts(timelineData);
  const allAlerts = [...uptimeAlerts, ...timelineAlerts];
  if (allAlerts.length > 0) {
    sendSlackAlerts([...uptimeAlerts, ...timelineAlerts]);
  }
  institutionStatuses = { uptime: uptimeData, timeline: timelineData };
}

/*
 * Returns a list of institutions that were previously in level 'clear'
 * and now are in level 'error' or 'warning'
 *
 * @param {Array} institutionUptimes - A list of bank uptimes
 * @returns {Array} - A list of new bank alerts
*/
function getUptimeAlerts(institutionUptimes) {
  return Object.keys(institutionUptimes)
    .filter(institutionName => {
      const { current } = institutionUptimes[institutionName];
      let previouslyClear = true;
      if (institutionStatuses.uptime[current.title]) {
        previouslyClear = institutionStatuses.uptime[current.title].current.level === 'clear';
      }
      return PROBLEM_STATUSES.includes(current.level) && previouslyClear;
    })
    .map(institutionName => {
      const { title, level, percentage } = institutionUptimes[institutionName].current;
      const alertString = `\nAlert-level: *${level}* \nUptime: *${percentage}* \n`;
      return {
        text: alertString,
        color: level === 'error' ? 'danger' : 'warning',
        institutionName,
      };
    });
}

/*
 * Returns a list of current institution alerts, each coming with a description,
 * title, and the date the alert was activated
 *
 * @param {Array} institutionAlertTimeline - A list of current/previous institution alerts
 * @returns {Array} - A list current institution alerts that haven't already been recorded
*/
function getTimelineAlerts(institutionAlertTimeline) {
  const latestAlert = institutionAlertTimeline[0];
  const lastRecoredAlert = institutionStatuses.timeline[0];
  // No new alerts
  if (latestAlert.title === 'All Clear' || latestAlert.title === lastRecoredAlert.title) {
    return [];
  }
  // New alerts to send!
  const lastAllClear = institutionAlertTimeline.find((alert) => alert.title === 'All Clear');
  const indexOfAllClear = institutionAlertTimeline.indexOf(lastAllClear);
  const newTimelineAlerts = [];
  for (let i = 0; i < indexOfAllClear; i++) {
    newTimelineAlerts.push(institutionAlertTimeline[i]);
  }
  return newTimelineAlerts;
}

/*
 * Sends a slack message to the specified channel for each new plaid status alert.
 *
 * @param {Array} allAlerts - A list of new institution alerts
*/
function sendSlackAlerts(allAlerts) {
  const attachments = allAlerts.map(alertBody => {
    return {
      "fallback": 'Plaid Alert',
      "pretext": 'Plaid Alert',
      "color": alertBody.color,
      "fields":[
         {
            "title": alertBody.institutionName,
            "value": alertBody.text,
            "short": false,
         },
      ]
    };
  });
  const options = {
    uri: SLACK_WEBHOOK_URL,
    body: { text: '', attachments },
    json: true,
  };
  request.post(options);
}

setInterval(checkPlaidStatus, CHECK_STATUS_INTERVAL);
