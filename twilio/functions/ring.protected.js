/* /ring  (skyddad: Twilio kontrollerar signaturen, så bara Twilio kan anropa den)
   TwiML-appens röstadress. Webbläsaren skickar bara kontaktens id; numret
   slås upp här. Okänd kontakt, eller anrop som inte kommer från Bänkgrannen,
   avvisas. Samtalet spelas aldrig in. */
exports.handler = function (context, event, callback) {
  const { contacts } = require(Runtime.getFunctions()['delat'].path);
  const twiml = new Twilio.twiml.VoiceResponse();

  const from = String(event.From || event.Caller || '');
  if (from !== 'client:bankgrannen') {
    console.warn('Avvisat: fel avsändare', from);
    twiml.reject();
    return callback(null, twiml);
  }

  const id = String(event.kontakt || '');
  const c = contacts(context).find((x) => x.id === id);
  if (!c || !context.CALLER_ID) {
    console.warn('Avvisat: okänd kontakt eller CALLER_ID saknas', id);
    twiml.reject();
    return callback(null, twiml);
  }

  const dial = twiml.dial({
    callerId: context.CALLER_ID,
    answerOnBridge: true,   // webbläsarens samtal öppnas först när personen svarar
    timeout: 30,            // ingen svarar inom 30 sekunder: samtalet avbryts
    timeLimit: 480,         // högst åtta minuter
  });
  dial.number(c.nummer.replace(/[\s-]/g, ''));
  return callback(null, twiml);
};
