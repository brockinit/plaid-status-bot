const fs = require('fs');
const path = require('path');
const request = require('request-promise-native');
const institutionStatuses = require('./institutionStatuses.json');

const PLAID_API = {
  STATUS_HOST: 'https://status.plaid.com',
  UPTIME_URL: '/institutions/uptime',
  TIMELINE_URL: '/issues/timeline',
};
const PROBLEM_STATUSES = ['warning', 'error'];
// Should come from .env
const SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/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"

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

  sendSlackAlerts(uptimeAlerts, timelineAlerts);
  // writeNewDataToDisk(uptimeData, timelineData);
}

function writeNewDataToDisk() {
  fs.writeFileSync(
    path.resolve(__dirname, './institutionStatuses.json'),
    JSON.stringify({ uptime: uptimeData, timeline: timelineData })
  );
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
      const previouslyClear = institutionStatuses.uptime[current.title].current.level === 'clear';
      return PROBLEM_STATUSES.includes(current.level) && previouslyClear;
    })
    .map(institutionName => institutionUptimes[institutionName].current);
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

function sendSlackAlerts(uptimeAlerts, timelineAlerts) {
  // Do nothing if there are no alerts to send
  if (uptimeAlerts.length === 0 && timelineAlerts.length === 0) {
    return;
  }

  // Ping slack!
  let alertString = 'New plaid alert! ';
  uptimeAlerts.forEach(({ title, level, percentage }) => {
    alertString += `\nBank: ${title} \nAlert-level: ${level} \nUptime: ${percentage} \n`;
  });
  const options = {
    uri: SLACK_WEBHOOK_URL,
    body: { text: alertString },
    json: true,
  };
  request.post(options);
  console.log(uptimeAlerts, 'UPTIME');
  console.log(timelineAlerts, 'TIMELINE');
}

checkPlaidStatus();