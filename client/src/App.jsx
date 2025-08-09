import React, { useEffect, useMemo, useRef, useState } from 'react'

const COLORS = (v)=> v<0 ? 'value--neg' : (v===0?'value--zero':'value--pos')

export default function App(){
  const [ws, setWs] = useState(null)
  const [roomId, setRoomId] = useState(null)
  const [playerId, setPlayerId] = useState(null)
  const [state, setState] = useState(null)
  const [you, setYou] = useState(null)
  const [pending, setPending] = useState(null)
  const [waitingReveal, setWaitingReveal] = useState(false)
  const nameRef = useRef(null)

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const s = new WebSocket(`${proto}://${location.host}`)
    s.onmessage = ev => {
      const msg = JSON.parse(ev.data)
      if (msg.t==='created' || msg.t==='joined') {
        setRoomId(msg.roomId); setPlayerId(msg.playerId)
      }
      if (msg.t==='state') { setState(msg.state); setYou(msg.you) }
      if (msg.t==='drew') { setPending(msg.card) }
    }
    setWs(s)
    return () => s.close()
  }, [])

  const send = (o)=> ws && ws.readyState===1 && ws.send(JSON.stringify(o))
  const isMyTurn = useMemo(()=>state?.players?.[state.turn]?.id === playerId,[state,playerId])

  const create = ()=> send({ t:'create', name: nameRef.current?.value || 'Spieler' })
  const join = ()=> {
    const rid = prompt('Raumcode (z. B. ABC123):')?.trim().toUpperCase()
    if (!rid) return
    send({ t:'join', roomId: rid, name: nameRef.current?.value || 'Spieler' })
  }
  const start = ()=> send({ t:'start' })
  const drawDeck = ()=> { if (isMyTurn && !pending) send({ t:'drawDeck' }) }
  const takeDiscard = ()=> {
    if (!isMyTurn) return
    if (state.discardTop == null) return
    setPending(state.discardTop) // tatsächliche Aktion beim Klick auf Karte -> takeDiscard
  }
  const keep = ()=> alert('Klicke eine deiner Karten an, um zu tauschen.')
  const reject = ()=> { if (pending!=null) setWaitingReveal(true) }

  function onClickOwnCard(i, open){
    if (!isMyTurn) return
    if (pending!=null && !waitingReveal) {
      if (pending === state.discardTop) send({ t:'takeDiscard', index: i })
      else send({ t:'swapWithDrawn', index: i })
      setPending(null); setWaitingReveal(false)
      return
    }
    if (waitingReveal && !open) {
      send({ t:'rejectDrawn', index: i })
      setPending(null); setWaitingReveal(false)
    }
  }

  return (
    <div className="app">
      <h1><img className="logo" src="/logo.svg" alt=""/> SkyGrid</h1>

      {!playerId &&
        <div className="panel row">
          <input className="input" placeholder="Dein Name" ref={nameRef}/>
          <button className="btn" onClick={create}>Neues Spiel</button>
          <button className="btn" onClick={join}>Beitreten</button>
        </div>
      }

      {playerId && !state?.started &&
        <div className="panel">
          <div className="row">
            <div>Raum: <b>{roomId}</b></div>
            <button className="btn" onClick={start}>Spiel starten</button>
          </div>
          <div className="section">
            {state?.players?.map(p=>(
              <div key={p.id} className="player">
                <div><b>{p.name}</b> – Gesamt: <span className="score">{p.total}</span> {p.isTurn && <span className="tag">am Zug</span>}</div>
              </div>
            ))}
          </div>
          <div className="small">Tipp: Teile den Raumcode mit deinen Freund:innen.</div>
        </div>
      }

      {playerId && state?.started &&
        <div className="panel">
          <div className="row">
            <div className={"pile"+(!isMyTurn || pending ? " muted": "")} onClick={drawDeck}>
              Ziehstapel<br/><b>{state.drawCount}</b>
            </div>
            <div className={"pile"+(!isMyTurn ? " muted": "")} onClick={takeDiscard}>
              Ablage<br/><b>{state.discardTop ?? '-'}</b>
            </div>
            <span className="tag">Am Zug: {state.players?.[state.turn]?.name}</span>
            {state.roundClosing ? <span className="tag muted">Letzte Runde</span> :
              (state.endedByIndex!=null ? <span className="tag muted">Runde schließt</span> : null)}
          </div>

          <h3>Deine Auslage</h3>
          <div className="grid">
            {you?.grid?.map((v,i)=>{
              const open = you.faceUp?.includes(i)
              const pickable = isMyTurn && ((pending!=null && !waitingReveal) || (!open && waitingReveal))
              return (
                <div key={i}
                  className={`card ${open?'open':'hidden'} ${pickable?'pickable':''} ${open?COLORS(v):''}`}
                  title={pickable? (waitingReveal? "Aufdecken":"Tauschen"): ""}
                  onClick={()=>onClickOwnCard(i, open)}>
                  {open? v: ""}
                </div>
              )
            })}
          </div>

          {pending!=null &&
            <div className="row section">
              <span>Gezogen: <b>{pending}</b></span>
              <button className="btn" onClick={keep}>Behalten</button>
              <button className="btn" onClick={reject}>Ablegen & verdeckte Karte aufdecken</button>
            </div>
          }

          <h3>Mitspieler</h3>
          <div>
            {state.players?.filter(p=>p.id!==playerId).map(p=>(
              <div key={p.id} className="player">
                <div><b>{p.name}</b> – Runde: {p.scoreRound ?? 0} – Gesamt: {p.total} {p.isTurn && <span className="tag">am Zug</span>}</div>
                <div className="grid">
                  {p.gridPublic.map((v,i)=>(
                    <div key={i} className={`card ${v==null?'hidden':'open'} ${v!=null?COLORS(v):''}`}>{v ?? ""}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      }
    </div>
  )
}
