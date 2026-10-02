import type { Language, Snapshot, Trace } from "./protocol";

export interface Lesson {
  id: string;
  title: string;
  subtitle: string;
  chapter: string;
  minutes: number;
  concept: string;
  optimize: string;
  code: Record<Language, string>;
  steps: Snapshot[];
  question: string;
  answers: string[];
  correct: number;
  reason: string;
}
const ref = (id: string) => ({ ref: id });
const snap = (
  line: number,
  title: string,
  explanation: string,
  operation: string,
  locals: Snapshot["frames"][number]["locals"],
  heap: Snapshot["heap"] = {},
  focus: string[] = [],
): Snapshot => ({
  line,
  event: "after",
  frames: [{ id: "0", name: "Global", locals }],
  heap,
  stdout: "",
  lesson: { title, explanation, operation, focus },
});
const array = (values: number[]) => ({
  type: "Array",
  entries: values.map((v, i): [string, number] => [String(i), v]),
});
const codes = (javascript: string, python: string, cppBody: string): Record<Language, string> => ({
  javascript,
  python,
  cpp: `#include <iostream>\n#include <vector>\n#include <map>\n#include <set>\n#include <string>\n#include <algorithm>\nusing namespace std;\n\nint main() {\n${cppBody
    .split("\n")
    .map((l) => "  " + l)
    .join("\n")}\n  return 0;\n}`,
});

export const LESSONS: Lesson[] = [
  {
    id: "first-instruction",
    chapter: "01 · The computer",
    title: "From Enter to an answer",
    subtitle: "Input, instructions, and output",
    minutes: 3,
    concept:
      "Source code is a recipe. A language runtime turns that recipe into work the computer can perform. RAM holds working data; the processor executes machine instructions. This animation simplifies that pipeline.",
    optimize:
      "Start by measuring repeated work and large inputs. Source steps do not equal CPU cycles; compilation, caches, and the runtime affect real performance.",
    code: codes(
      "const input = 21;\nconst answer = input * 2;\nconsole.log(answer);",
      "value = 21\nanswer = value * 2\nprint(answer)",
      "int input = 21;\nint answer = input * 2;\ncout << answer << endl;",
    ),
    steps: [
      snap(
        0,
        "You press Run",
        "The editor sends your text to the language runtime. Typing Enter in the editor simply adds a new line; Run starts execution.",
        "input",
        {},
      ),
      snap(
        0,
        "Read the recipe",
        "JavaScript and Python use a runtime. C++ is compiled into a program first. Syntax errors can stop this stage.",
        "parse",
        {},
      ),
      snap(
        1,
        "Keep the input",
        "The name input is associated with the number 21. Think of a labeled box you can find again.",
        "write",
        { input: 21 },
      ),
      snap(
        2,
        "Bring in the next instruction",
        "Conceptually, the processor fetches and decodes instructions that will calculate the answer. One source line may require many machine instructions.",
        "fetch",
        { input: 21 },
      ),
      snap(
        2,
        "Do the calculation",
        "Multiply 21 by 2 and associate answer with 42. The ALU is the part of a processor that performs arithmetic and logic.",
        "execute",
        { input: 21, answer: 42 },
      ),
      {
        ...snap(
          3,
          "Show the result",
          "The output stream receives 42. The interface presents that output as text.",
          "output",
          { input: 21, answer: 42 },
        ),
        stdout: "42\n",
      },
    ],
    question: "Does one line of source code always take one CPU cycle?",
    answers: ["Yes, every line costs the same", "No, a line can involve many instructions"],
    correct: 1,
    reason:
      "Language runtimes, generated machine code, memory access, and hardware all affect the work a line requires.",
  },
  {
    id: "arrays",
    chapter: "02 · Values & memory",
    title: "An array, one place at a time",
    subtitle: "Indexes, movement, and swapping",
    minutes: 4,
    concept:
      "An array groups values in order. An index names a position, starting at zero in these languages. A reference points to the group, so several names can refer to the same data.",
    optimize:
      "Index lookup is usually constant time. Repeatedly scanning the whole array grows with input size. Inserting at its beginning can require shifting many values.",
    code: codes(
      "const numbers = [8, 3, 5, 1];\nlet left = 0;\nlet right = 3;\n[numbers[left], numbers[right]] = [numbers[right], numbers[left]];\nleft++;\nright--;\nconsole.log(numbers);",
      "numbers = [8, 3, 5, 1]\nleft = 0\nright = 3\nnumbers[left], numbers[right] = numbers[right], numbers[left]\nleft += 1\nright -= 1\nprint(numbers)",
      "vector<int> numbers = {8, 3, 5, 1};\nint left = 0;\nint right = 3;\nswap(numbers[left], numbers[right]);\nleft++;\nright--;",
    ),
    steps: [
      snap(
        1,
        "A row of values",
        "Four values live in an ordered collection. numbers refers to the collection; index 0 holds 8.",
        "allocate",
        { numbers: ref("1") },
        { "1": array([8, 3, 5, 1]) },
      ),
      snap(
        3,
        "Mark the two ends",
        "left is 0 and right is 3. These numbers are positions, not the values stored there.",
        "read",
        { numbers: ref("1"), left: 0, right: 3 },
        { "1": array([8, 3, 5, 1]) },
        ["1:0", "1:3"],
      ),
      snap(
        4,
        "Exchange the ends",
        "The two values exchange positions. The collection still contains the same four values.",
        "swap",
        { numbers: ref("1"), left: 0, right: 3 },
        { "1": array([1, 3, 5, 8]) },
        ["1:0", "1:3"],
      ),
      snap(
        5,
        "Move one place right",
        "Increasing left from 0 to 1 moves our attention toward the middle.",
        "move-right",
        { numbers: ref("1"), left: 1, right: 3 },
        { "1": array([1, 3, 5, 8]) },
        ["1:1"],
      ),
      snap(
        6,
        "Move one place left",
        "Decreasing right from 3 to 2 moves the other marker toward the middle.",
        "move-left",
        { numbers: ref("1"), left: 1, right: 2 },
        { "1": array([1, 3, 5, 8]) },
        ["1:2"],
      ),
    ],
    question: "What does numbers[0] mean?",
    answers: ["The first value in numbers", "The number of values"],
    correct: 0,
    reason: "The index selects a position. Length tells you how many positions exist.",
  },
  {
    id: "references",
    chapter: "02 · Values & memory",
    title: "Two names, one object",
    subtitle: "References, aliasing, and linked lists",
    minutes: 4,
    concept:
      "A reference is a way to reach an object. Copying a reference does not copy the object. Linked structures store references to connect separate objects; cycles are possible.",
    optimize:
      "Linked lists can insert after a known node without shifting an array, but finding that node may require a scan. Extra references also use space.",
    code: codes(
      "const tail = { value: 20, next: null };\nconst head = { value: 10, next: tail };\nconst cursor = head;\ncursor.value = 7;\nconsole.log(head.value);",
      'tail = {"value": 20, "next": None}\nhead = {"value": 10, "next": tail}\ncursor = head\ncursor["value"] = 7\nprint(head["value"])',
      "struct Node { int value; Node* next; };\nNode tail{20, nullptr};\nNode head{10, &tail};\nNode* cursor = &head;\ncursor->value = 7;\ncout << head.value;",
    ),
    steps: [
      snap(
        1,
        "Create the last node",
        "This node stores 20 and has no next node.",
        "allocate",
        { tail: ref("2") },
        {
          "2": {
            type: "Node",
            entries: [
              ["value", 20],
              ["next", null],
            ],
          },
        },
      ),
      snap(
        2,
        "Connect a first node",
        "head reaches the first node. Its next field points to the second node.",
        "link",
        { head: ref("1"), tail: ref("2") },
        {
          "1": {
            type: "Node",
            entries: [
              ["value", 10],
              ["next", ref("2")],
            ],
          },
          "2": {
            type: "Node",
            entries: [
              ["value", 20],
              ["next", null],
            ],
          },
        },
      ),
      snap(
        3,
        "A second name for the same node",
        "cursor and head both refer to object #1. There is still only one first node.",
        "reference",
        { head: ref("1"), cursor: ref("1"), tail: ref("2") },
        {
          "1": {
            type: "Node",
            entries: [
              ["value", 10],
              ["next", ref("2")],
            ],
          },
          "2": {
            type: "Node",
            entries: [
              ["value", 20],
              ["next", null],
            ],
          },
        },
      ),
      snap(
        4,
        "Change through either name",
        "Writing through cursor changes the object that head also sees. Both references still lead to #1.",
        "write",
        { head: ref("1"), cursor: ref("1"), tail: ref("2") },
        {
          "1": {
            type: "Node",
            entries: [
              ["value", 7],
              ["next", ref("2")],
            ],
          },
          "2": {
            type: "Node",
            entries: [
              ["value", 20],
              ["next", null],
            ],
          },
        },
        ["1:value"],
      ),
    ],
    question: "After cursor changes the node, what does head see?",
    answers: ["The old value, 10", "The new value, 7"],
    correct: 1,
    reason: "Both names reach the same object, so a mutation is visible through either reference.",
  },
  {
    id: "stack-queue",
    chapter: "03 · Organizing data",
    title: "Stacks & waiting lines",
    subtitle: "Last in, first out. First in, first out.",
    minutes: 3,
    concept:
      "A stack behaves like a pile of plates: take the newest item first. A queue behaves like a waiting line: serve the oldest item first. These are rules of use, not a particular memory layout.",
    optimize:
      "Removing the first element of an array may shift the rest. A deque or circular buffer can implement queue removal without that repeated shifting.",
    code: codes(
      "const stack = [];\nstack.push(10);\nstack.push(20);\nconst newest = stack.pop();\nconst queue = [10, 20];\nconst oldest = queue.shift();",
      "stack = []\nstack.append(10)\nstack.append(20)\nnewest = stack.pop()\nfrom collections import deque\nqueue = deque([10, 20])\noldest = queue.popleft()",
      "vector<int> stack;\nstack.push_back(10);\nstack.push_back(20);\nint newest = stack.back();\nstack.pop_back();\nvector<int> queue = {10, 20};\nint oldest = queue.front();\nqueue.erase(queue.begin());",
    ),
    steps: [
      snap(
        2,
        "Push the first value",
        "10 is now the top of the stack.",
        "push",
        { stack: ref("1") },
        { "1": { ...array([10]), type: "Stack" } },
      ),
      snap(
        3,
        "Push another value",
        "20 becomes the top. It will be removed before 10.",
        "push",
        { stack: ref("1") },
        { "1": { ...array([10, 20]), type: "Stack" } },
        ["1:1"],
      ),
      snap(
        4,
        "Pop the newest value",
        "The stack returns 20 and keeps 10.",
        "pop",
        { stack: ref("1"), newest: 20 },
        { "1": { ...array([10]), type: "Stack" } },
      ),
      snap(
        5,
        "Join a queue",
        "10 arrived first; 20 is behind it.",
        "enqueue",
        { queue: ref("2") },
        { "2": { ...array([10, 20]), type: "Queue" } },
      ),
      snap(
        6,
        "Serve the oldest value",
        "The queue returns 10. Now 20 is at the front.",
        "dequeue",
        { queue: ref("2"), oldest: 10 },
        { "2": { ...array([20]), type: "Queue" } },
        ["2:0"],
      ),
    ],
    question: "Which structure is a natural fit for undoing the most recent action?",
    answers: ["A stack", "A queue"],
    correct: 0,
    reason: "Undo normally reverses the most recent action first: last in, first out.",
  },
  {
    id: "maps",
    chapter: "03 · Organizing data",
    title: "Find things by name",
    subtitle: "Maps, sets, hashing, and collisions",
    minutes: 4,
    concept:
      "A map pairs keys with values; a set tracks membership. Hash tables use a hash to find a bucket, then compare keys to handle collisions. The exact buckets are runtime details and are not shown as measured memory.",
    optimize:
      "Hash lookup is often constant time on average, but collisions, resizing, and expensive keys can change the cost. C++ std::map instead uses an ordered tree with logarithmic lookup.",
    code: codes(
      'const scores = new Map();\nscores.set("Ada", 9);\nscores.set("Lin", 7);\nconst score = scores.get("Ada");\nconst seen = new Set(["Ada", "Ada", "Lin"]);',
      'scores = {}\nscores["Ada"] = 9\nscores["Lin"] = 7\nscore = scores["Ada"]\nseen = {"Ada", "Ada", "Lin"}',
      'map<string, int> scores;\nscores["Ada"] = 9;\nscores["Lin"] = 7;\nint score = scores["Ada"];\nset<string> seen = {"Ada", "Ada", "Lin"};',
    ),
    steps: [
      snap(
        2,
        "Associate a name with a score",
        "The key Ada leads to 9. You can ask for Ada without knowing an array position.",
        "insert",
        { scores: ref("1") },
        { "1": { type: "Map", entries: [["Ada", 9]] } },
      ),
      snap(
        3,
        "Keep another association",
        "Lin gets a separate entry. A hash collision would not make two unequal keys the same key.",
        "insert",
        { scores: ref("1") },
        {
          "1": {
            type: "Map",
            entries: [
              ["Ada", 9],
              ["Lin", 7],
            ],
          },
        },
      ),
      snap(
        4,
        "Look up Ada",
        "Lookup returns the value associated with this key.",
        "read",
        { scores: ref("1"), score: 9 },
        {
          "1": {
            type: "Map",
            entries: [
              ["Ada", 9],
              ["Lin", 7],
            ],
          },
        },
        ["1:Ada"],
      ),
      snap(
        5,
        "A set keeps unique members",
        "Adding Ada twice still leaves just one Ada. Membership is the question a set answers.",
        "insert",
        { seen: ref("2") },
        {
          "2": {
            type: "Set",
            entries: [
              ["0", "Ada"],
              ["1", "Lin"],
            ],
          },
        },
      ),
    ],
    question: "If two unequal keys have the same hash, must their entries overwrite each other?",
    answers: ["Yes", "No, the table also checks key equality"],
    correct: 1,
    reason: "Collision handling distinguishes unequal keys even when they share a hash or bucket.",
  },
  {
    id: "trees",
    chapter: "03 · Organizing data",
    title: "Trees & priorities",
    subtitle: "Branches, binary search trees, and heaps",
    minutes: 4,
    concept:
      "A tree connects parents to children. In a binary search tree, smaller values go left and larger ones go right. A min-heap has a different rule: each parent is no larger than its children.",
    optimize:
      "A balanced search tree keeps paths short. A skewed tree may be as slow as a list. A heap is useful for repeatedly choosing the smallest or highest-priority item, not arbitrary sorted lookup.",
    code: codes(
      "const root = { value: 8, left: null, right: null };\nroot.left = { value: 3, left: null, right: null };\nroot.right = { value: 12, left: null, right: null };\nconst found = root.left.value;",
      'root = {"value": 8, "left": None, "right": None}\nroot["left"] = {"value": 3}\nroot["right"] = {"value": 12}\nfound = root["left"]["value"]',
      "struct Node { int value; Node* left; Node* right; };\nNode left{3, nullptr, nullptr};\nNode right{12, nullptr, nullptr};\nNode root{8, &left, &right};\nint found = root.left->value;",
    ),
    steps: [
      snap(
        1,
        "Start at a root",
        "8 is the first node. A root gives us an entry point into the tree.",
        "allocate",
        { root: ref("1") },
        {
          "1": {
            type: "Tree node",
            entries: [
              ["value", 8],
              ["left", null],
              ["right", null],
            ],
          },
        },
      ),
      snap(
        2,
        "Smaller values go left",
        "3 is smaller than 8, so this binary search tree places it in the left subtree.",
        "link",
        { root: ref("1") },
        {
          "1": {
            type: "Tree node",
            entries: [
              ["value", 8],
              ["left", ref("2")],
              ["right", null],
            ],
          },
          "2": { type: "Tree node", entries: [["value", 3]] },
        },
      ),
      snap(
        3,
        "Larger values go right",
        "12 is larger than 8. These links form a branching structure.",
        "link",
        { root: ref("1") },
        {
          "1": {
            type: "Tree node",
            entries: [
              ["value", 8],
              ["left", ref("2")],
              ["right", ref("3")],
            ],
          },
          "2": { type: "Tree node", entries: [["value", 3]] },
          "3": { type: "Tree node", entries: [["value", 12]] },
        },
      ),
      snap(
        4,
        "Follow one branch",
        "To find 3, compare with 8, then follow the left link. We can skip the entire right subtree.",
        "visit",
        { root: ref("1"), found: 3 },
        {
          "1": {
            type: "Tree node",
            entries: [
              ["value", 8],
              ["left", ref("2")],
              ["right", ref("3")],
            ],
          },
          "2": { type: "Tree node", entries: [["value", 3]] },
          "3": { type: "Tree node", entries: [["value", 12]] },
        },
        ["2:value"],
      ),
    ],
    question:
      "Does a min-heap require all values in the left subtree to be smaller than those in the right subtree?",
    answers: ["Yes", "No, only the parent-child priority rule applies"],
    correct: 1,
    reason:
      "A heap and a binary search tree have different invariants. Choose based on the operation you need.",
  },
  {
    id: "graphs",
    chapter: "03 · Organizing data",
    title: "Networks, grids & paths",
    subtitle: "Graphs, adjacency lists, and matrices",
    minutes: 4,
    concept:
      "A graph is a collection of nodes and connections. An adjacency list stores each node's neighbors. A matrix stores values by row and column; it can represent a grid or which pairs of graph nodes connect.",
    optimize:
      "Adjacency lists are often compact for sparse graphs. A full adjacency matrix needs space proportional to the square of the number of nodes. Track visited nodes to avoid repeating cycles.",
    code: codes(
      'const a = { name: "A", next: null };\nconst b = { name: "B", next: null };\na.next = b;\nb.next = a;\nconst grid = [[1, 0], [0, 1]];',
      'a = {"name": "A", "next": None}\nb = {"name": "B", "next": None}\na["next"] = b\nb["next"] = a\ngrid = [[1, 0], [0, 1]]',
      'struct Node { string name; Node* next; };\nNode a{"A", nullptr};\nNode b{"B", nullptr};\na.next = &b;\nb.next = &a;\nint grid[2][2] = {{1,0},{0,1}};',
    ),
    steps: [
      snap(
        2,
        "Two independent nodes",
        "A and B have names but no connections yet.",
        "allocate",
        { a: ref("1"), b: ref("2") },
        {
          "1": { type: "Node", entries: [["name", "A"]] },
          "2": { type: "Node", entries: [["name", "B"]] },
        },
      ),
      snap(
        3,
        "Connect A to B",
        "A directed connection allows us to move from A to B.",
        "link",
        { a: ref("1"), b: ref("2") },
        {
          "1": {
            type: "Node",
            entries: [
              ["name", "A"],
              ["next", ref("2")],
            ],
          },
          "2": { type: "Node", entries: [["name", "B"]] },
        },
      ),
      snap(
        4,
        "A cycle appears",
        "B now points back to A. Repeatedly following next never ends unless we track where we have been.",
        "link",
        { a: ref("1"), b: ref("2") },
        {
          "1": {
            type: "Node",
            entries: [
              ["name", "A"],
              ["next", ref("2")],
            ],
          },
          "2": {
            type: "Node",
            entries: [
              ["name", "B"],
              ["next", ref("1")],
            ],
          },
        },
      ),
      snap(
        5,
        "Rows point to collections",
        "This two-dimensional grid has two rows. In this teaching model, the outer collection refers to each row. Actual C++ built-in arrays have a different contiguous layout.",
        "allocate",
        { grid: ref("3") },
        {
          "3": {
            type: "Matrix",
            entries: [
              ["0", ref("4")],
              ["1", ref("5")],
            ],
          },
          "4": array([1, 0]),
          "5": array([0, 1]),
        },
      ),
    ],
    question: "Why keep a visited set when exploring a graph?",
    answers: ["To avoid processing the same node repeatedly", "To sort every node"],
    correct: 0,
    reason: "Cycles and shared neighbors can lead back to nodes already explored.",
  },
  {
    id: "recursion",
    chapter: "04 · Solving problems",
    title: "A function calling itself",
    subtitle: "Call frames, base cases, and returning",
    minutes: 4,
    concept:
      "Each function call has its own working variables and a return point. Recursion makes a smaller version of the same request until a base case can answer directly.",
    optimize:
      "Repeated subproblems may benefit from memoization. Deep recursion consumes call-stack space; an explicit stack or iteration may avoid stack overflow.",
    code: codes(
      "function factorial(n) {\n  if (n <= 1) return 1;\n  return n * factorial(n - 1);\n}\nconst answer = factorial(3);\nconsole.log(answer);",
      "def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\nanswer = factorial(3)\nprint(answer)",
      "auto factorial = [](auto self, int n) -> int {\n  if (n <= 1) return 1;\n  return n * self(self, n - 1);\n};\nint answer = factorial(factorial, 3);\ncout << answer;",
    ),
    steps: [3, 2, 1, 2, 3].map((n, i) => ({
      ...snap(
        0,
        i < 3 ? `Ask for factorial(${n})` : `Return to factorial(${n})`,
        i === 2
          ? "The base case returns 1. This stops the chain of calls."
          : i < 2
            ? `This call keeps its own n = ${n}, then asks for factorial(${n - 1}).`
            : `The smaller call has answered. Multiply that answer by ${n} and return to the caller.`,
        i < 3 ? "call" : "return",
        {},
      ),
      frames: [
        { id: "0", name: "Global", locals: {} },
        ...Array.from({ length: i < 3 ? i + 1 : 5 - i }, (_, j) => ({
          id: String(j + 1),
          name: "factorial",
          locals: { n: 3 - j },
        })),
      ],
    })),
    question: "What stops this recursion?",
    answers: ["The function name", "The base case n <= 1"],
    correct: 1,
    reason: "A base case answers directly instead of making another recursive call.",
  },
  {
    id: "binary-search",
    chapter: "04 · Solving problems",
    title: "Do less work",
    subtitle: "Binary search and growing inputs",
    minutes: 4,
    concept:
      "Binary search works on sorted data. Compare the middle item with the target, then discard the half that cannot contain the answer. Repeated halving takes logarithmically many comparisons.",
    optimize:
      "Count the work as input grows. Binary search reduces comparisons, but sorting a one-off unsorted input just to search once may cost more than a linear scan.",
    code: codes(
      "const values = [2, 4, 6, 8, 10, 12, 14];\nconst target = 12;\nlet left = 0, right = values.length - 1;\nwhile (left <= right) {\n  const mid = Math.floor((left + right) / 2);\n  if (values[mid] === target) { console.log(mid); break; }\n  if (values[mid] < target) left = mid + 1;\n  else right = mid - 1;\n}",
      "values = [2, 4, 6, 8, 10, 12, 14]\ntarget = 12\nleft, right = 0, len(values) - 1\nwhile left <= right:\n    mid = (left + right) // 2\n    if values[mid] == target:\n        print(mid)\n        break\n    if values[mid] < target:\n        left = mid + 1\n    else:\n        right = mid - 1",
      "vector<int> values = {2,4,6,8,10,12,14};\nint target = 12, left = 0, right = 6;\nwhile (left <= right) {\n  int mid = left + (right - left) / 2;\n  if (values[mid] == target) { cout << mid; break; }\n  if (values[mid] < target) left = mid + 1;\n  else right = mid - 1;\n}",
    ),
    steps: [
      snap(
        1,
        "Begin with sorted values",
        "The ordering lets us rule out a whole half at a time.",
        "read",
        { values: ref("1"), target: 12, left: 0, right: 6 },
        { "1": array([2, 4, 6, 8, 10, 12, 14]) },
      ),
      snap(
        5,
        "Compare the middle",
        "Index 3 contains 8. Since 12 is larger, the target cannot be at or to the left of this position.",
        "compare",
        { values: ref("1"), target: 12, left: 0, right: 6, mid: 3 },
        { "1": array([2, 4, 6, 8, 10, 12, 14]) },
        ["1:3"],
      ),
      snap(
        7,
        "Discard the left half",
        "Move left to 4. Only indexes 4 through 6 remain possible.",
        "move-right",
        { values: ref("1"), target: 12, left: 4, right: 6 },
        { "1": array([2, 4, 6, 8, 10, 12, 14]) },
        ["1:4", "1:5", "1:6"],
      ),
      snap(
        6,
        "Found in two comparisons",
        "The new middle is index 5, which contains 12. The search is done.",
        "compare",
        { values: ref("1"), target: 12, left: 4, right: 6, mid: 5 },
        { "1": array([2, 4, 6, 8, 10, 12, 14]) },
        ["1:5"],
      ),
    ],
    question: "What must be true before ordinary binary search works?",
    answers: ["The values must be sorted", "The values must be unique"],
    correct: 0,
    reason: "Sorted order justifies discarding half the remaining positions after each comparison.",
  },
];

export function lessonTrace(lesson: Lesson, language: Language): Trace {
  // Lesson beats are semantic, not executable line mappings across languages.
  return {
    version: 1,
    language,
    source: lesson.code[language],
    origin: "lesson",
    steps: lesson.steps.map((step) => ({ ...step, line: 0 })),
    notes: [
      "Guided concept animation. Press Run code to record the actual program in the selected language.",
      "Object IDs are teaching labels, not physical memory addresses. CPU stages are conceptual.",
    ],
  };
}
