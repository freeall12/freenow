import {createQuestionWaiter} from '../agent-question-runtime/waiter.mjs';

// Both user-input tools share the same abort/stale-view boundary. A skipped
// form is an explicit result, not a successful confirmation or a default value.
export function createFormWaiter(options){
 return createQuestionWaiter({...options,label:'表单'});
}
