'use strict';

// Preserve shutdown ordering, but a failed store must not skip cleanup and
// transaction settlement in the remaining independently owned stores.
async function closeInOrder(closures) {
  const failures = [];
  for (const close of closures) {
    try {await close();} catch (error) {failures.push(error);}
  }
  if (failures.length) throw new AggregateError(failures, 'Local persistence shutdown was not confirmed.');
}
module.exports = {closeInOrder};
