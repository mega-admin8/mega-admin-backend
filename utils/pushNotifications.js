// utils/pushNotifications.js
import { Expo } from 'expo-server-sdk';

const expo = new Expo();

export async function sendFundRequestNotification(userPushToken, status, amount, reason = '') {
  if (!Expo.isExpoPushToken(userPushToken)) {
    console.error(`Invalid Expo push token: ${userPushToken}`);
    return;
  }

  const isApproved = status === 'APPROVED';

  const message = {
    to: userPushToken,
    sound: 'default',
    title: isApproved ? 'Fund Request Approved! 🎉' : 'Fund Request Rejected ❌',
    body: isApproved
      ? `Your fund request for $${amount} has been approved.`
      : `Your fund request for $${amount} was rejected.${reason ? ` Reason: ${reason}` : ''}`,
    data: { type: 'FUND_REQUEST', status, amount },
  };

  try {
    const chunks = expo.chunkPushNotifications([message]);
    for (const chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
}