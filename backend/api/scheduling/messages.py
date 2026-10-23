"""Translatable messages for the pure (Django-free) optimizers.

Msg behaves like the English string, but keeps its template and parameters so the Django layer can show it
in the reader's language later: Msg("%(group)s needs %(n)s lessons", group="5-A", n=6).
"""


class Msg(str):
    def __new__(cls, template, **params):
        obj = super().__new__(cls, template % params if params else template)
        obj.template = template
        obj.params = params
        return obj

    def as_payload(self):
        def plain(v):
            if isinstance(v, Msg):
                return v.as_payload()
            return v if isinstance(v, (int, float, str, bool, type(None))) else str(v)
        return {"t": self.template, "p": {k: plain(v) for k, v in self.params.items()}}
