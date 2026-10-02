import unittest
from python_trace import trace_python


class TraceTests(unittest.TestCase):
    def test_values_and_output(self):
        result = trace_python("values = [1, 2, 3]\nanswer = sum(values)\nprint(answer)")
        self.assertEqual(result["steps"][-1]["stdout"], "6\n")
        self.assertEqual(result["steps"][-1]["event"], "end")

    def test_aliases_and_cycle(self):
        result = trace_python("a = []\nb = a\na.append(a)\nb.append(4)")
        final = result["steps"][-1]
        values = final["frames"][0]["locals"]
        self.assertEqual(values["a"], values["b"])
        self.assertEqual(final["heap"][values["a"]["ref"]]["entries"][0][1], values["a"])

    def test_recursion(self):
        result = trace_python("def f(n):\n    return n * f(n-1) if n > 1 else 1\nanswer = f(5)\nprint(answer)")
        self.assertEqual(result["steps"][-1]["stdout"], "120\n")
        self.assertTrue(any(len(step["frames"]) == 6 for step in result["steps"]))

    def test_input_and_errors(self):
        self.assertEqual(trace_python("print(input())", "hello\n")["steps"][-1]["stdout"], "hello\n")
        self.assertEqual(trace_python("bad syntax !")["steps"][-1]["event"], "error")
        self.assertEqual(trace_python("raise ValueError('broken')")["steps"][-1]["event"], "error")

    def test_limit(self):
        result = trace_python("while True:\n    pass")
        self.assertEqual(result["steps"][-1]["event"], "limit")
        self.assertLessEqual(len(result["steps"]), 2002)

    def test_large_int(self):
        result = trace_python("n = 10**30")
        self.assertEqual(result["steps"][-1]["frames"][0]["locals"]["n"], {"special": str(10**30)})


if __name__ == "__main__":
    unittest.main()
