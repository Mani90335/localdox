import type { Language } from "./protocol.ts";

export const TEACHING: Record<
  string,
  {
    goal: string;
    analogy: string;
    word: string;
    meaning: string;
    practice: string;
    lines?: Record<Language, number[]>;
  }
> = {
  "first-instruction": {
    // Explicit teaching highlights, separate from recorded runtime line events.
    lines: { javascript: [0, 1, 2, 3], python: [0, 1, 2, 3], cpp: [0, 10, 11, 12] },
    goal: "See how three instructions turn 21 into 42.",
    analogy: "A program is a short recipe. The computer follows the instructions in order.",
    word: "variable",
    meaning:
      "A name for a value you want to use again. Here, number remembers 21 and answer remembers 42.",
    practice: "Change 21 to 10 in the code, then press Run code. Can you predict the result?",
  },
  arrays: {
    goal: "Watch two values trade places in a row.",
    analogy:
      "Think of numbered lockers. The locker number tells you where to look; the value is what is inside.",
    word: "index",
    meaning:
      "The position of a value in a row. Counting starts at 0 here, so index 0 means the first place.",
    practice: "Change the first value from 8 to 20. Run the code and watch where 20 ends up.",
  },
  references: {
    goal: "Find out why changing one name can affect another.",
    analogy: "Two bookmarks can open the same page. Two names can also lead to the same object.",
    word: "reference",
    meaning:
      "A way to find an existing object. Making another reference does not make another copy of that object.",
    practice:
      "Change a value in the example and run it. Check both names in Memory: are they pointing to the same object?",
  },
  "stack-queue": {
    goal: "Compare taking from a pile with taking from a waiting line.",
    analogy:
      "With a stack of plates, you take the top plate first. In a queue at a shop, the first person in line goes first.",
    word: "stack and queue",
    meaning:
      "A stack removes the most recently added item. A queue removes the item that has waited longest.",
    practice: "Add one more item to the example, then run it. Predict which item will leave first.",
  },
  maps: {
    goal: "Look up a value by name, and keep track of unique items.",
    analogy:
      "A contact list finds a number by a person's name. A guest list with no duplicates keeps each name only once.",
    word: "map and set",
    meaning:
      "A map pairs a key with a value. A set keeps unique values, so adding the same value twice does not create two entries.",
    practice:
      "Change a value in the map and run it. Find the key and its new value in the picture.",
  },
  trees: {
    goal: "Follow branches, then see how a heap keeps a priority at the top.",
    analogy:
      "A family tree connects parents to children. A priority queue keeps the most urgent item ready to take next.",
    word: "tree and heap",
    meaning:
      "A tree has branching parent–child connections. A heap is a tree with a priority rule between each parent and its children; it is not fully sorted.",
    practice:
      "Change a number in the example and run it. Follow the connections to see where that value is stored.",
  },
  graphs: {
    goal: "Follow connections between places, even when a path loops back.",
    analogy:
      "A road map has places and roads connecting them. Unlike a family tree, a road can take you back to where you started.",
    word: "graph",
    meaning:
      "A collection of points, called nodes, with connections, called edges. A grid can also describe connected places.",
    practice:
      "Open Connections to follow a path. Can you find one that returns to a place you already visited?",
  },
  recursion: {
    goal: "See a task ask for a smaller task, then collect the answers.",
    analogy:
      "Imagine a pile of sticky notes. Each unfinished task gets a note. Finish the top note before returning to the one below it.",
    word: "recursion",
    meaning:
      "A function calls itself with a smaller problem. It needs a stopping case so it does not keep asking forever.",
    practice:
      "Use a smaller starting number and run the example. Compare how many unfinished calls appear in Memory.",
  },
  "binary-search": {
    goal: "Find a number by ruling out half the choices at a time.",
    analogy:
      "In an alphabetized dictionary, you open near the middle and decide which half to search next.",
    word: "binary search",
    meaning:
      "Check the middle of a sorted list. Keep only the half that could contain the answer, then repeat.",
    practice:
      "Change the target to another value already in the list. Run the code and follow the left and right markers.",
  },
};
