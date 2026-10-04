/* POST /kontakter  (formulär: key=<telefonnyckeln>)
   Telefonlistan UTAN nummer: [{ id, namn, roll, arende }].
   Numren lämnar aldrig Twilio. */
exports.handler = function (context, event, callback) {
  const { contacts, keyOk, response, fail } = require(Runtime.getFunctions()['delat'].path);
  const { res, originOk } = response(context, event);
  if (!originOk) return callback(null, fail(res, 403, 'Fel ursprung'));
  if (!keyOk(context, event.key)) return callback(null, fail(res, 401, 'Fel telefonnyckel'));

  res.setBody(contacts(context).map((c) => ({
    id: c.id,
    namn: c.namn,
    roll: typeof c.roll === 'string' ? c.roll : '',
    arende: typeof c.arende === 'string' ? c.arende : '',
  })));
  return callback(null, res);
};
