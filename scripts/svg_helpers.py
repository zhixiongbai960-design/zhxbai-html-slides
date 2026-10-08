"""Standard-library SVG helpers for editable diagrams; compose relationships from actual content."""
from html import escape
from itertools import count
_svg_ids = count(1)
BLUE='#0052D9'; INK='#111827'; MUTED='#647084'; PALE='#EDF3FF'; LINE='#DCE4EF'
def text(x,y,value,size=32,color=INK,weight=650,anchor='middle'):
    lines=value.split('\n')
    return ''.join(f'<text x="{x}" y="{y+i*size*1.4}" font-size="{size}" fill="{color}" font-weight="{weight}" text-anchor="{anchor}">{escape(line)}</text>' for i,line in enumerate(lines))
def rect(x,y,w,h,fill=PALE,stroke='none',r=12):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="2"/>'
def circle(x,y,r,fill=PALE,stroke='none'):
    return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="2"/>'
def path(d,arrow=False,color=BLUE,dash=False,width=3):
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"'+(' marker-end="url(#ARROW)"' if arrow else '')+(' stroke-dasharray="8 8"' if dash else '')+'/>'
def node(x,y,w,h,title,desc='',fill=PALE,title_size=34):
    color='white' if fill==BLUE else INK
    s=rect(x,y,w,h,fill)+text(x+w/2,y+(h/2+12 if not desc else h/2-9),title,title_size,color)
    if desc:s+=text(x+w/2,y+h/2+42,desc,25,'#DCE7FF' if fill==BLUE else MUTED,450)
    return '<g data-node="true">'+s+'</g>'
def svg(label,body,width=1440,height=420):
    key='svg_arrow_'+str(next(_svg_ids))
    body=body.replace('ARROW',key)
    return f'<svg class="visual" viewBox="0 0 {width} {height}" role="img" aria-label="{escape(label)}"><title>{escape(label)}</title><defs><marker id="{key}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10Z" fill="{BLUE}"/></marker></defs>{body}</svg>'
def doc(x,y,w=110,h=140,label=''):
    s=rect(x,y,w,h,'white',LINE,4)+path(f'M{x+20} {y+34} H{x+w-20}',color=BLUE)+path(f'M{x+20} {y+56} H{x+w-20} M{x+20} {y+78} H{x+w-30}',color=LINE)
    if label:s+=text(x+w/2,y+h-20,label,24,BLUE)
    return s
def mic(x,y):
    return rect(x-16,y-35,32,58,'white',BLUE,16)+path(f'M{x-30} {y-4} V{y+12} Q{x-30} {y+44} {x} {y+44} Q{x+30} {y+44} {x+30} {y+12} V{y-4} M{x} {y+44} V{y+64} M{x-22} {y+64} H{x+22}')
