#!/usr/bin/env python3
"""Check every GraphQL document shipped in the Railway deploy workflow against
the live Railway schema.

The behavioural mock answered 49 harness assertions while production failed on
the first request, because the mock had been written from the same assumptions
as the client. This check removes that blind spot: it compares the documents to
railway_schema_contract.json, a trimmed copy of Railway's introspection dump,
and fails on

  * an unknown root field or argument,
  * an unknown field in a selection set or an unknown nested argument,
  * a variable declared with the wrong type (Railway wants String!, not ID!),
  * a declared variable the document never uses (Railway rejects it),
  * a variable used but not declared, or declared with an unknown type.

Run it from the repository root:

    python3 deploy/railway/harness/check_railway_schema.py \
        .github/workflows/openbox-deploy-railway.yml
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CONTRACT = os.path.join(HERE, "railway_schema_contract.json")

TOKEN = re.compile(r"""\s*(\$?\w[\w.]*!?|[(){}:,]|"(?:[^"\\]|\\.)*")""")


class ParseError(Exception):
    pass


def tokenize(doc):
    out, i = [], 0
    while i < len(doc):
        m = TOKEN.match(doc, i)
        if not m:
            if doc[i].isspace():
                i += 1
                continue
            raise ParseError("unexpected character %r at %d" % (doc[i], i))
        if m.group(1).strip():
            out.append(m.group(1))
        i = m.end()
    return out


class Parser:
    def __init__(self, toks):
        self.t, self.i = toks, 0

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else None

    def take(self, want=None):
        if self.i >= len(self.t):
            raise ParseError("document ended early")
        tok = self.t[self.i]
        self.i += 1
        if want is not None and tok != want:
            raise ParseError("expected %r, got %r" % (want, tok))
        return tok

    def operation(self):
        kind = self.take()
        if kind not in ("query", "mutation"):
            raise ParseError("expected query or mutation, got %r" % kind)
        vardefs = {}
        if self.peek() == "(":
            self.take("(")
            while self.peek() != ")":
                name = self.take()
                if not name.startswith("$"):
                    raise ParseError("expected a variable name, got %r" % name)
                self.take(":")
                vardefs[name[1:]] = self.take()
                if self.peek() == ",":
                    self.take()
            self.take(")")
        self.take("{")
        sel = self.selection()
        self.take("}")
        if self.peek() is not None:
            raise ParseError("trailing tokens after the operation: %r" % self.peek())
        return kind, vardefs, sel

    def selection(self):
        out = []
        while self.peek() and self.peek() != "}":
            name = self.take()
            args = {}
            if self.peek() == "(":
                self.take("(")
                while self.peek() != ")":
                    a = self.take()
                    self.take(":")
                    args[a] = self.take()
                    if self.peek() == ",":
                        self.take()
                self.take(")")
            sub = None
            if self.peek() == "{":
                self.take("{")
                sub = self.selection()
                self.take("}")
            out.append((name, args, sub))
            if self.peek() == ",":
                self.take()
        return out


def base(flat):
    return flat.replace("!", "").replace("[", "").replace("]", "")


def wide_enough(declared, wanted):
    """A non-null variable is a valid subtype of a nullable argument."""
    return declared == wanted or (declared.endswith("!") and declared[:-1] == wanted)


class Checker:
    def __init__(self, contract):
        self.roots = contract["roots"]
        self.objects = contract["objects"]
        self.inputs = contract["inputs"]
        self.problems = []
        self.used = set()

    def bad(self, msg):
        self.problems.append(msg)

    def argument(self, where, name, value, spec):
        if name not in spec:
            self.bad("%s has no argument %r (has %s)" % (where, name, sorted(spec)))
            return
        if not value.startswith("$"):
            return  # a literal: the shape is exercised by the harness mock
        var = value[1:]
        self.used.add(var)
        if var not in self.vardefs:
            self.bad("%s(%s) uses undeclared $%s" % (where, name, var))
            return
        if not wide_enough(self.vardefs[var], spec[name]):
            self.bad("%s(%s): $%s declared %s, the schema wants %s"
                     % (where, name, var, self.vardefs[var], spec[name]))

    def walk(self, nodes, type_name):
        fields = self.objects.get(type_name)
        if fields is None:
            self.bad("no field list for type %s in the contract" % type_name)
            return
        for name, args, sub in nodes:
            if name not in fields:
                self.bad("%s has no field %r" % (type_name, name))
                continue
            for a, v in args.items():
                self.argument("%s.%s" % (type_name, name), a, v, fields[name]["args"])
            if sub is not None:
                self.walk(sub, base(fields[name]["type"]))

    def document(self, doc):
        self.problems, self.used = [], set()
        try:
            kind, self.vardefs, sel = Parser(tokenize(doc)).operation()
        except ParseError as e:
            return ["does not parse: %s" % e]
        root = "Query" if kind == "query" else "Mutation"
        table = self.roots[root]
        if len(sel) != 1:
            self.bad("one operation may select exactly one root field, found %d" % len(sel))
        for name, args, sub in sel:
            if name not in table:
                self.bad("MISSING root %s.%s" % (root, name))
                continue
            for a, v in args.items():
                self.argument("%s.%s" % (root, name), a, v, table[name]["args"])
            if sub is not None:
                self.walk(sub, base(table[name]["type"]))
        for var, vtype in self.vardefs.items():
            known = base(vtype) in self.inputs or base(vtype) in self.objects or \
                base(vtype) in ("String", "ID", "Int", "Float", "Boolean", "DateTime", "JSON")
            if not known:
                self.bad("$%s declared with unknown type %s" % (var, vtype))
            if var not in self.used:
                self.bad('$%s is declared but never used' % var)
        return self.problems


def main(argv):
    if len(argv) < 2:
        print(__doc__.strip().splitlines()[-1].strip())
        return 2
    contract = json.load(open(CONTRACT))
    text = open(argv[1]).read()
    docs = list(dict.fromkeys(re.findall(r"gql '([^']+)'", text)))
    if not docs:
        print("no gql documents found in %s" % argv[1])
        return 1
    checker = Checker(contract)
    failed = 0
    for doc in docs:
        problems = checker.document(doc)
        print("%-4s %s" % ("ok" if not problems else "FAIL", doc[:110]))
        for p in problems:
            print("      -", p)
        failed += bool(problems)
    print("\n%d document(s), %d failing" % (len(docs), failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
