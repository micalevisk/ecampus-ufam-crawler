const { assert, array, defaulted, string, boolean, object, func, optional } = require('superstruct');

const lazyPrompts = () => require('prompts');

/**
 * @param {string} objKey
 */
const unpack = (objKey) => (obj = {}) => obj[objKey];

/**
 * @param {object} opts
 * @param {string} opts.message
 * @param {{text:string, key:string}[]} opts.questions
 * @param { (prompt:any, answer:any) => void } [opts.onCancel = ()=>{}]
 *
 * @returns {Promise<string | undefined>}
 */
module.exports.selector = (opts) => {
  const prompts = lazyPrompts();

  const Options = object({
    message: string(),
    questions: array(object({
      text: string(),
      key: string(),
    })),

    onCancel: optional(defaulted(func(), () => {})),
  });
  assert(opts, Options);

  const promptQuestionsChoices = opts.questions.map(({ text, key }) => ({
    title: text,
    value: key,
  }));
  const promptQuestions = {
    type: 'select',
    name: 'reply',
    message: opts.message,
    choices: promptQuestionsChoices,
  };

  return prompts(promptQuestions, {
    onCancel: opts.onCancel,
  }).then(unpack('reply'));
};


/**
 * @param {object} opts
 * @param {string} opts.message
 * @param {boolean} [opts.hide = false]
 * @param {boolean} [opts.mandatory = false]
 *
 * @returns {Promise<string | undefined>}
 */
module.exports.input = (opts) => {
  const prompts = lazyPrompts();

  const Options = object({
    message: string(),

    hide: optional(defaulted(boolean(), false)),
    mandatory: optional(defaulted(boolean(), false)),
  });
  assert(opts, Options);

  const promptQuestion = {
    type: 'text',
    style: opts.hide ? 'password' : 'default',
    name: 'reply',
    message: opts.message,
    ...(opts.mandatory && ({validate: (input = '') => !!input.trim() })),
  };

  return prompts(promptQuestion).then(unpack('reply'));
}

