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
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const CHECK_STATUS_INTERVAL = 30000;

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
  writeNewDataToDisk(uptimeData, timelineData);
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
    .map(institutionName => {
      const { title, level, percentage } = institutionUptimes[institutionName].current;
      const alertString = `\nBank: *${title}* \nAlert-level: *${level}* \nUptime: *${percentage}* \n`;
      return {
        text: alertString,
        color: level === 'error' ? 'danger' : 'warning',
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

function sendSlackAlerts(uptimeAlerts, timelineAlerts) {
  // Do nothing if there are no alerts to send
  if (uptimeAlerts.length === 0 && timelineAlerts.length === 0) {
    return;
  }

  // Ping slack!
  uptimeAlerts.forEach(alertBody => {
    const options = {
      uri: SLACK_WEBHOOK_URL,
      body: alertBody,
      json: true,
    };
    request.post(options);
  });
  console.log(uptimeAlerts, 'UPTIME');
  console.log(timelineAlerts, 'TIMELINE');
}

setInterval(checkPlaidStatus, CHECK_STATUS_INTERVAL);