/* POST /token  (formulär: key=<telefonnyckeln>)
   Ger webbläsaren en tillfällig nyckel för Twilios Voice SDK.
   Bara utgående samtal via TwiML-appen, giltig en timme. */
exports.handler = function (context, event, callback) {
  const { keyOk, response, fail } = require(Runtime.getFunctions()['delat'].path);
  const { res, originOk } = response(context, event);
  if (!originOk) return callback(null, fail(res, 403, 'Fel ursprung'));
  if (!keyOk(context, event.key)) return callback(null, fail(res, 401, 'Fel telefonnyckel'));

  const missing = ['API_KEY_SID', 'API_KEY_SECRET', 'TWIML_APP_SID'].filter((k) => !context[k]);
  if (missing.length) return callback(null, fail(res, 500, 'Saknar ' + missing.join(', ')));

  const AccessToken = Twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;
  const token = new AccessToken(context.ACCOUNT_SID, context.API_KEY_SID, context.API_KEY_SECRET, {
    identity: 'bankgrannen',
    ttl: 3600,
  });
  token.addGrant(new VoiceGrant({ outgoingApplicationSid: context.TWIML_APP_SID, incomingAllow: false }));

  res.setBody({ token: token.toJwt(), ttl: 3600 });
  return callback(null, res);
};
