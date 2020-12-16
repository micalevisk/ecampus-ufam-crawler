require('dotenv/config');

const puppeteer = require('puppeteer');
const readline = require('readline');
const Table = require('cli-table');


/**
 * Esperar um input do usuário via stdin.
 * @param {string} query Messagem de prompt.
 * @param {boolean} [hide=false] Esconder a entrada do usuário.
 * @returns {Promise<string>} A entrada do usuário.
 */
function askQuestionToUser(query, hide = false) {
  const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
  });

  rl._writeToOutput = stringToWrite =>
    rl.output.write(
        hide
      ? '\x1B[2K\x1B[200D' + query + '[' + ( (rl.line.length % 2) ? '=-' : '-=' ) + ']'
      : stringToWrite
    );

  return new Promise(resolve =>
    rl.question(query, ans => {
      rl.close();
      resolve(ans);
    })
  );
}


/**
 * Dedicated method to page to click and wait for navigation.
 * adapted from (c) https://github.com/GoogleChrome/puppeteer/issues/1421
 * @param {puppeteer.Page} page
 * @param {string} selector
 * @param {puppeteer.NavigationOptions} waitOptions
 * @returns {Promise<puppeteer.Response>}
 */
async function clickAndWaitNavi(page, selector, waitOptions) {
  return Promise.all([
    page.waitForNavigation(waitOptions),
    page.click(selector)
  ]).then(value => value[0]);
}

async function initPuppeteer(browserOpts) {
  const headless = process.env.DEBUG !== 'true';
  const defaultLaunchOptions = { headless, args: ['--no-sandbox'] };
  const browser = await puppeteer.launch({ ...defaultLaunchOptions, ...browserOpts });
  const page = await browser.newPage();
  return { browser, page };
}

// (c) https://github.com/GoogleChrome/puppeteer/issues/2423
async function takeScreenshotOnElement({ page, width = 2000, height = 800, selector }) {
  const genImageName = () => `${(new Date().toTimeString()).split(' ')[0].replace(/\D/g, '_')}.png`;

  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  const elHandle = await page.$(selector);
  const filename = genImageName();
  await elHandle.screenshot({ path: filename  });

  return filename;
}

const  nodeToString = nodeElement => window['recuperarConteudo'](nodeElement);
const nodesToString = nodes => nodes.map(nodeElement => window['recuperarConteudo'](nodeElement)); // não aceita usar um CB

//#region [helpers] especializados para o crawler do Ecampus UFAM

const initPageFeatures = function () {
  window['recuperarConteudo'] = ({ textContent, innerHTML }) => {
    if ( innerHTML.includes('Notas Efetivadas') ) return '#'; // especilizado para `Notas e Frequência`
    return textContent
      // .replace(/(\\n|\\t)|(<[^>]+>)|(&nbsp;)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };
};

async function loginIndex(page, { login, password }) {
  await page.evaluateOnNewDocument(initPageFeatures);
  await page.goto('https://ecampus.ufam.edu.br/ecampus/home/login');
  console.error('>> Redirecionado');

  // Inserir o Login
  await page.click('input[type="text"]');
  await page.keyboard.press('Home');
  await page.keyboard.type(login);
  console.error('>> CPF inserido');

  // Inserir a Senha
  await page.click('input[type="password"]');
  await page.keyboard.press('Home')
  await page.keyboard.type(password);
  console.error('>> Senha inserida');

  // Logar
  await clickAndWaitNavi(page, 'input[type="submit"]', {waitUntil: 'networkidle0'});
  console.error(`>> Logado com sucesso`);

  // Recuperar informação de sessão
  const session = await page.$eval('#user-information', nodeToString);

  return Promise.resolve(session);
}

async function selectModule(page, moduleName) {
  await clickAndWaitNavi(page, `a[alt="${moduleName}"]`, {waitUntil: 'networkidle0'});
  console.error(`>> Módulo '${moduleName}' acessado com sucesso`);
}

const panelSelectors = {
  'Quadro de Horário':                'h3 > a[href*="quadroHorario"]',
  'Notas e Frequência':               'h3 > a[href*="notas"]',
  'Espelho Solicitação de Matrícula': 'h3 > a[href*="Espelho"]',
};

async function selectPanel(page, panelName) {
  await clickAndWaitNavi(page, panelSelectors[panelName], {waitUntil: 'networkidle2'});
  console.error(`>> '${panelName}' acessado com sucesso`)
}

const menuSelectors = {
  'Home' :                  '#accordion > [role="tab"]:nth-child(1)',
  'Serviços':               '#accordion > [role="tab"]:nth-child(3)',
  'Declarações':            '#accordion > [role="tab"]:nth-child(5)',
  'Consultas e Relatórios': '#accordion > [role="tab"]:nth-child(7)'
};

async function selectMenu(page, menuName) {
  await page.click(menuSelectors[menuName]);
}

//#endregion

// TODO: tornar genérico, para qualquer menu & painel disponível
async function performEcampusCrawler({ login, password }) {
  const { browser, page } = await initPuppeteer().catch(err => { throw err; });

  try {

    const session = await loginIndex(page, {login, password});
    console.log(session);

    await selectModule(page, 'Aluno');

    await selectMenu(page, 'Consultas e Relatórios');

    await selectPanel(page, 'Notas e Frequência');

    // await page.select('select#periodo', '202'); // selecionar o período
    const ano = await page.$eval('#ano', e => e.value);
    const periodo = await page.$eval('#periodo', seletor => seletor.selectedOptions[0].text);
    console.log(`Período Selecionado: ${ano}/${periodo}`);

    /*
    // await page.click('#buscar') //.waitForSelector('.grid-notas');
    // await page.$eval('#buscar', btn => btn.click());
    await Promise.all([
      page.click('#buscar'),
      page.waitForSelector('.tabelas.grid-notas'),
    ]);
    */

    const elNotas = await page.$('table.tabelas.grid-notas');

    if (!elNotas) throw new Error('`Tabela de notas` not found');

    const validColumns = [0,2,4,6,8,10,  21,22,23,24,25,26]; // apenas colunas interessantes para a tabela final
    const filterByValidColumns = arr => arr.filter((_, i) => validColumns.includes(i));

    //#region [main] serializando o <TABLE>
    const [tableHead, ...tableBody] = await elNotas.$$('tr');
    const tableHeadValues = await tableHead.$$eval('th', nodesToString);
    const serializedTable = [ filterByValidColumns(tableHeadValues) ];

    for (const tableRow of tableBody) {
      const tableDatas = await tableRow.$$eval('td', nodesToString);
      serializedTable.push( filterByValidColumns(tableDatas) );
    }
    //#endregion

    return Promise.resolve(serializedTable);

  } finally {
    await browser.close();
  }
}



(async function __main__() {

  const    login = process.env.ECAMPUS_LOGIN    || await askQuestionToUser('> Seu CPF: ');
  const password = process.env.ECAMPUS_PASSWORD || await askQuestionToUser('> Sua senha: ', true);
  // const    opcao = process.argv[2];

  try {
    const tabelaSerializada = await performEcampusCrawler({login, password});

    const prettyTable = new Table({
      head: tabelaSerializada[0],
      style: {
        head: ['bgMagenta'],
        border: ['red'],
      },
      colAligns: Array(tabelaSerializada[0].length).fill('center')
    });

    prettyTable.push( ...tabelaSerializada.slice(1) );

    console.log( prettyTable.toString() );
  } catch (err) {
    console.error(`
    --------------------
    ${err.message}
    --------------------
    `);

    process.exit(1);
  }

}());