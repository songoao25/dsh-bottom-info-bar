// 一致性测试：验证 lib/index.js 和 lib/client.js 中内联的 SUBSCRIPTION_PROVIDERS / BILLING_PROVIDERS 与 src/constants.js 单一生源一致
// 用法：node tests/test-subscription-providers-consistency.js
const fs = require('fs')
const path = require('path')

const rootDir = path.join(__dirname, '..')
const constantsSrc = fs.readFileSync(path.join(rootDir, 'plugin', 'src', 'constants.js'), 'utf8')
const hostLib = fs.readFileSync(path.join(rootDir, 'plugin', 'lib', 'index.js'), 'utf8')
const clientLib = fs.readFileSync(path.join(rootDir, 'plugin', 'lib', 'client.js'), 'utf8')

// 从 constants.js 提取期望的数组（末尾可能有或没有分号）
function extractExpected(name) {
  const match = constantsSrc.match(new RegExp('export const ' + name + ' = (\\[[\\s\\S]*?\\]);?'))
  if (!match) {
    console.error('FAIL: 无法从 constants.js 中提取 ' + name)
    process.exit(1)
  }
  return eval('(' + match[1] + ')')
}
const expectedSub = extractExpected('SUBSCRIPTION_PROVIDERS')
const expectedBill = extractExpected('BILLING_PROVIDERS')

// 从 lib/index.js 提取实际内联的数组（锚点已被替换）
function extractFrom(text, decl) {
  const match = text.match(new RegExp(decl + ' = (\\[[\\s\\S]*?\\]);?'))
  if (!match) {
    console.error('FAIL: 无法从构建产物中提取 ' + decl)
    process.exit(1)
  }
  return eval('(' + match[1] + ')')
}
const hostSub = extractFrom(hostLib, 'const SUBSCRIPTION_PROVIDERS')
const hostBill = extractFrom(hostLib, 'const BILLING_PROVIDERS')
const clientSub = extractFrom(clientLib, 'var SUBSCRIPTION_PROVIDERS')
const clientBill = extractFrom(clientLib, 'var BILLING_PROVIDERS')

let pass = 0
let fail = 0

function check(label, actual, expectedVal) {
  const ok = JSON.stringify(actual) === JSON.stringify(expectedVal)
  if (ok) {
    pass++
    console.log('PASS  ' + label)
  } else {
    fail++
    console.log('FAIL  ' + label + ' → 期望 ' + JSON.stringify(expectedVal) + '，实际 ' + JSON.stringify(actual))
  }
}

check('constants.js 订阅集合有效', expectedSub.length > 0, true)
check('constants.js 账单集合有效', expectedBill.length > 0, true)
check('lib/index.js 订阅列表与 constants.js 一致', hostSub, expectedSub)
check('lib/index.js 账单列表与 constants.js 一致', hostBill, expectedBill)
check('lib/client.js 订阅列表与 constants.js 一致', clientSub, expectedSub)
check('lib/client.js 账单列表与 constants.js 一致', clientBill, expectedBill)
check('host 与 client 产物订阅列表彼此一致', hostSub, clientSub)
check('host 与 client 产物账单列表彼此一致', hostBill, clientBill)

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL')
if (fail > 0) process.exit(1)